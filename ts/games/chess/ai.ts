/**
 * Pure TypeScript Chess AI & Evaluation / Win Predictor ("Grandmaster Protocol").
 * Implements:
 * - Static positional & material evaluation (PST, bishop pair, pawn structure, open files, king safety/endgame)
 * - Sigmoid win probability & human-readable predicted winner labels
 * - Novice (depth 1 + bounded jitter), Club (depth 2 alpha-beta + quiescence),
 *   and Master (depth 3 iterative deepening alpha-beta + MVV-LVA + PV ordering + quiescence < 300ms)
 *
 * Zero DOM dependencies.
 */

import {
  cloneBoard,
  findKingSquare,
  generateLegalMoves,
  isKingInCheck,
  isSquareAttacked,
  opponentColor,
  rowColToSq,
  sqToRowCol,
} from './engine.js';
import type {
  CastlingRights,
  ChessState,
  Color,
  Difficulty,
  EvalPrediction,
  Move,
  Piece,
  PieceType,
  PromotionPieceType,
} from './types.js';

const MATE_SCORE = 100000;
const INFINITY_SCORE = 1000000;
const MASTER_TIME_BUDGET_MS = 240;

const PROMO_TYPES: readonly PromotionPieceType[] = ['q', 'r', 'b', 'n'];

const CENTIPAWN_VALUE: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables from White's perspective (row 0 = rank 8, row 7 = rank 1).
// Black uses mirrored row (7 - row), ensuring 100% symmetry at starting position.
const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  12, 14, 22, 32, 32, 22, 14, 12,
  6, 8, 14, 26, 26, 14, 8, 6,
  2, 2, 8, 22, 22, 8, 2, 2,
  4, -4, -6, 0, 0, -6, -4, 4,
  6, 10, 10, -20, -20, 10, 10, 6,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 4, 4, 0, -20, -40,
  -30, 4, 14, 18, 18, 14, 4, -30,
  -30, 6, 18, 24, 24, 18, 6, -30,
  -30, 4, 18, 24, 24, 18, 4, -30,
  -30, 8, 14, 16, 16, 14, 8, -30,
  -40, -20, 0, 6, 6, 0, -20, -40,
  -50, -36, -30, -30, -30, -30, -36, -50,
];

const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 4, 0, 0, 0, 0, 4, -10,
  -10, 10, 10, 14, 14, 10, 10, -10,
  -10, 4, 12, 14, 14, 12, 4, -10,
  -10, 8, 8, 14, 14, 8, 8, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 8, 0, 0, 0, 0, 8, -10,
  -20, -10, -12, -10, -10, -12, -10, -20,
];

const ROOK_PST = [
  0, 0, 2, 6, 6, 2, 0, 0,
  10, 16, 16, 16, 16, 16, 16, 10,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  0, 0, 2, 8, 8, 4, 0, 0,
];

const QUEEN_PST = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 6, 6, 6, 6, 0, -10,
  -5, 0, 6, 8, 8, 6, 0, -5,
  0, 0, 6, 8, 8, 6, 0, -5,
  -10, 4, 6, 6, 6, 6, 0, -10,
  -10, 0, 4, 0, 0, 0, 0, -10,
  -20, -10, -10, -4, -4, -10, -10, -20,
];

const KING_MID_PST = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  18, 18, 0, -6, -6, 0, 18, 18,
  20, 32, 12, 0, 0, 10, 34, 20,
];

const KING_END_PST = [
  -40, -30, -20, -15, -15, -20, -30, -40,
  -25, -15, 0, 8, 8, 0, -15, -25,
  -20, 0, 16, 24, 24, 16, 0, -20,
  -15, 6, 22, 32, 32, 22, 6, -15,
  -15, 6, 22, 32, 32, 22, 6, -15,
  -20, 0, 16, 24, 24, 16, 0, -20,
  -25, -15, 0, 8, 8, 0, -15, -25,
  -40, -30, -20, -15, -15, -20, -30, -40,
];

const KNIGHT_DELTAS: readonly [number, number][] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

const KING_DELTAS: readonly [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];

const BISHOP_DIRS: readonly [number, number][] = [
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];

const ROOK_DIRS: readonly [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

const QUEEN_DIRS: readonly [number, number][] = [...BISHOP_DIRS, ...ROOK_DIRS];

function clampNumber(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function getPieceSquareBonus(type: PieceType, row: number, col: number, color: Color, endgameBlend: number): number {
  const r = color === 'w' ? row : 7 - row;
  const idx = (r << 3) | col;
  switch (type) {
    case 'p':
      return PAWN_PST[idx];
    case 'n':
      return KNIGHT_PST[idx];
    case 'b':
      return BISHOP_PST[idx];
    case 'r':
      return ROOK_PST[idx];
    case 'q':
      return QUEEN_PST[idx];
    case 'k':
      return Math.round(
        KING_MID_PST[idx] * (1 - endgameBlend) + KING_END_PST[idx] * endgameBlend,
      );
  }
}

/**
 * Evaluates a 64-square board from White's perspective in centipawns.
 */
function evaluateRawBoard(board: readonly (Piece | null)[]): number {
  let nonPawnMaterial = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  const whitePawnFiles = [0, 0, 0, 0, 0, 0, 0, 0];
  const blackPawnFiles = [0, 0, 0, 0, 0, 0, 0, 0];
  const whiteMostBackPawnRow = [0, 0, 0, 0, 0, 0, 0, 0];
  const blackMostBackPawnRow = [7, 7, 7, 7, 7, 7, 7, 7];

  for (let sq = 0; sq < 64; sq += 1) {
    const p = board[sq];
    if (!p) continue;
    const { row, col } = sqToRowCol(sq);
    if (p.type === 'p') {
      if (p.color === 'w') {
        whitePawnFiles[col] += 1;
        if (row > whiteMostBackPawnRow[col]) whiteMostBackPawnRow[col] = row;
      } else {
        blackPawnFiles[col] += 1;
        if (row < blackMostBackPawnRow[col]) blackMostBackPawnRow[col] = row;
      }
    } else if (p.type !== 'k') {
      nonPawnMaterial += CENTIPAWN_VALUE[p.type];
      if (p.type === 'b') {
        if (p.color === 'w') whiteBishops += 1;
        else blackBishops += 1;
      }
    }
  }

  // Starting non-pawn material = 2*(2*320 + 2*330 + 2*500 + 900) = 6400
  const endgameBlend = clampNumber(1 - nonPawnMaterial / 4800, 0, 1);

  let score = 0;

  for (let sq = 0; sq < 64; sq += 1) {
    const p = board[sq];
    if (!p) continue;
    const { row, col } = sqToRowCol(sq);
    const sign = p.color === 'w' ? 1 : -1;

    let pieceScore =
      p.type === 'k'
        ? getPieceSquareBonus('k', row, col, p.color, endgameBlend)
        : CENTIPAWN_VALUE[p.type] + getPieceSquareBonus(p.type, row, col, p.color, endgameBlend);

    if (p.type === 'p') {
      // Passed pawn check
      if (p.color === 'w') {
        let blocked = false;
        for (let adj = Math.max(0, col - 1); adj <= Math.min(7, col + 1); adj += 1) {
          if (blackPawnFiles[adj] > 0 && blackMostBackPawnRow[adj] < row) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          pieceScore += (7 - row) * 10;
        }
      } else {
        let blocked = false;
        for (let adj = Math.max(0, col - 1); adj <= Math.min(7, col + 1); adj += 1) {
          if (whitePawnFiles[adj] > 0 && whiteMostBackPawnRow[adj] > row) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          pieceScore += row * 10;
        }
      }
    } else if (p.type === 'r') {
      const ownPawns = p.color === 'w' ? whitePawnFiles[col] : blackPawnFiles[col];
      const enemyPawns = p.color === 'w' ? blackPawnFiles[col] : whitePawnFiles[col];
      if (ownPawns === 0 && enemyPawns === 0) {
        pieceScore += 18;
      } else if (ownPawns === 0) {
        pieceScore += 10;
      }
    }

    score += sign * pieceScore;
  }

  // Bishop pair
  if (whiteBishops >= 2) score += 35;
  if (blackBishops >= 2) score -= 35;

  // Pawn structure (doubled & isolated)
  for (let col = 0; col < 8; col += 1) {
    const wCount = whitePawnFiles[col];
    if (wCount > 1) score -= (wCount - 1) * 12;
    if (wCount > 0) {
      const hasNeighbor =
        (col > 0 && whitePawnFiles[col - 1] > 0) ||
        (col < 7 && whitePawnFiles[col + 1] > 0);
      if (!hasNeighbor) score -= 14 * wCount;
    }

    const bCount = blackPawnFiles[col];
    if (bCount > 1) score += (bCount - 1) * 12;
    if (bCount > 0) {
      const hasNeighbor =
        (col > 0 && blackPawnFiles[col - 1] > 0) ||
        (col < 7 && blackPawnFiles[col + 1] > 0);
      if (!hasNeighbor) score += 14 * bCount;
    }
  }

  return score;
}

/**
 * Evaluates a `ChessState` in centipawns from White's perspective.
 * Positive values favor White; negative values favor Black.
 */
export function evaluateBoard(state: ChessState): number {
  if (state.status === 'checkmate') {
    return state.winner === 'w' ? MATE_SCORE : -MATE_SCORE;
  }
  if (state.status !== 'active') {
    return 0;
  }
  let score = evaluateRawBoard(state.board);
  if (state.inCheck) {
    score += state.turn === 'w' ? -25 : 25;
  }
  return score;
}

function hasImmediateMateInOne(state: ChessState): boolean {
  const board = cloneBoard(state.board);
  const legal = generateLegalMoves(board, state.turn, state.castling, state.enPassantSq);
  const opp = opponentColor(state.turn);

  for (const move of legal) {
    const undo = applyMoveInPlace(board, state.castling, move);
    const inCheck = isKingInCheck(board, opp);
    let isMate = false;
    if (inCheck) {
      const nextEp =
        move.piece === 'p' && Math.abs(sqToRowCol(move.from).row - sqToRowCol(move.to).row) === 2
          ? ((move.from + move.to) >> 1)
          : null;
      const oppMoves = generateLegalMoves(board, opp, undo.nextCastling, nextEp);
      isMate = oppMoves.length === 0;
    }
    unapplyMoveInPlace(board, move, undo);
    if (isMate) {
      return true;
    }
  }
  return false;
}

/**
 * Computes centipawn evaluation, sigmoid White win probability (0..100),
 * and human-readable winner prediction from the current `ChessState`.
 */
export function predictWinner(state: ChessState): EvalPrediction {
  if (state.status === 'checkmate') {
    const whiteWon = state.winner === 'w';
    return {
      centipawns: whiteWon ? MATE_SCORE : -MATE_SCORE,
      pawnScore: whiteWon ? 999 : -999,
      whiteWinPct: whiteWon ? 100 : 0,
      blackWinPct: whiteWon ? 0 : 100,
      predictedWinner: whiteWon ? 'Checkmate — White Wins' : 'Checkmate — Black Wins',
      evalLabel: whiteWon ? '1-0' : '0-1',
      detail: whiteWon
        ? 'King trapped — decisive checkmate for White.'
        : 'King trapped — decisive checkmate for Black.',
    };
  }

  if (state.status !== 'active') {
    const drawReason =
      state.status === 'stalemate'
        ? 'Draw — Stalemate'
        : state.status === 'draw-insufficient'
          ? 'Draw — Insufficient Material'
          : state.status === 'draw-repetition'
            ? 'Draw — Threefold Repetition'
            : 'Draw — 50-Move Rule';
    return {
      centipawns: 0,
      pawnScore: 0,
      whiteWinPct: 50,
      blackWinPct: 50,
      predictedWinner: drawReason,
      evalLabel: '½-½',
      detail: 'Game concluded in an official draw.',
    };
  }

  if (hasImmediateMateInOne(state)) {
    const whiteToMate = state.turn === 'w';
    return {
      centipawns: whiteToMate ? MATE_SCORE - 1 : -(MATE_SCORE - 1),
      pawnScore: whiteToMate ? 999 : -999,
      whiteWinPct: whiteToMate ? 99 : 1,
      blackWinPct: whiteToMate ? 1 : 99,
      predictedWinner: whiteToMate ? 'White — Forced Mate' : 'Black — Forced Mate',
      evalLabel: whiteToMate ? 'M1' : '-M1',
      detail: whiteToMate
        ? 'White holds an immediate checkmate threat.'
        : 'Black holds an immediate checkmate threat.',
    };
  }

  const cp = evaluateBoard(state);
  const pawnRaw = cp / 100;
  const pawnScore = Math.round(pawnRaw * 10) / 10;
  const whiteWinPct = Math.round(clampNumber(100 / (1 + Math.exp(-cp / 320)), 1, 99));
  const blackWinPct = 100 - whiteWinPct;

  const formattedAbs = Math.abs(pawnRaw).toFixed(1);
  const evalLabel =
    Math.abs(cp) < 5 ? '+0.0' : cp > 0 ? `+${formattedAbs}` : `-${formattedAbs}`;

  let predictedWinner: string;
  if (Math.abs(cp) < 50) {
    predictedWinner = 'Even / Draw Likely';
  } else if (cp >= 50) {
    predictedWinner = `White Advantage (+${formattedAbs})`;
  } else {
    predictedWinner = `Black Advantage (-${formattedAbs})`;
  }

  let whiteMat = 0;
  let blackMat = 0;
  for (const p of state.board) {
    if (!p || p.type === 'k') continue;
    const val =
      p.type === 'p' ? 1 : p.type === 'n' || p.type === 'b' ? 3 : p.type === 'r' ? 5 : 9;
    if (p.color === 'w') whiteMat += val;
    else blackMat += val;
  }
  const matDiff = whiteMat - blackMat;
  const matDetail =
    matDiff === 0
      ? 'Material balanced'
      : matDiff > 0
        ? `White +${matDiff} material`
        : `Black +${Math.abs(matDiff)} material`;
  const checkDetail = state.inCheck
    ? ` • ${state.turn === 'w' ? 'White' : 'Black'} king in check`
    : '';

  return {
    centipawns: cp,
    pawnScore,
    whiteWinPct,
    blackWinPct,
    predictedWinner,
    evalLabel,
    detail: `${matDetail}${checkDetail}`,
  };
}

// ---------------------------------------------------------------------------
// Fast Internal Search (Negamax + Alpha-Beta + Quiescence + MVV-LVA)
// ---------------------------------------------------------------------------

interface InPlaceUndo {
  savedFrom: Piece | null;
  savedTo: Piece | null;
  epVictimSq: number;
  savedEpVictim: Piece | null;
  rookFrom: number;
  rookTo: number;
  savedRook: Piece | null;
  nextCastling: CastlingRights;
}

function applyMoveInPlace(
  board: (Piece | null)[],
  castling: CastlingRights,
  move: Move,
): InPlaceUndo {
  const savedFrom = board[move.from];
  const savedTo = board[move.to];
  let epVictimSq = -1;
  let savedEpVictim: Piece | null = null;
  let rookFrom = -1;
  let rookTo = -1;
  let savedRook: Piece | null = null;

  board[move.to] = move.promotion
    ? { color: move.color, type: move.promotion }
    : savedFrom;
  board[move.from] = null;

  if (move.isEnPassant) {
    epVictimSq = move.color === 'w' ? move.to + 8 : move.to - 8;
    savedEpVictim = board[epVictimSq];
    board[epVictimSq] = null;
  } else if (move.isCastling) {
    const backRow = move.color === 'w' ? 7 : 0;
    rookFrom = move.isCastling === 'K' ? rowColToSq(backRow, 7) : rowColToSq(backRow, 0);
    rookTo = move.isCastling === 'K' ? rowColToSq(backRow, 5) : rowColToSq(backRow, 3);
    savedRook = board[rookFrom];
    board[rookTo] = savedRook;
    board[rookFrom] = null;
  }

  const nextCastling: CastlingRights = {
    wK: castling.wK,
    wQ: castling.wQ,
    bK: castling.bK,
    bQ: castling.bQ,
  };
  if (move.piece === 'k') {
    if (move.color === 'w') {
      nextCastling.wK = false;
      nextCastling.wQ = false;
    } else {
      nextCastling.bK = false;
      nextCastling.bQ = false;
    }
  }
  if (move.from === 63 || move.to === 63) nextCastling.wK = false;
  if (move.from === 56 || move.to === 56) nextCastling.wQ = false;
  if (move.from === 7 || move.to === 7) nextCastling.bK = false;
  if (move.from === 0 || move.to === 0) nextCastling.bQ = false;

  return {
    savedFrom,
    savedTo,
    epVictimSq,
    savedEpVictim,
    rookFrom,
    rookTo,
    savedRook,
    nextCastling,
  };
}

function unapplyMoveInPlace(
  board: (Piece | null)[],
  move: Move,
  undo: InPlaceUndo,
): void {
  board[move.from] = undo.savedFrom;
  board[move.to] = undo.savedTo;
  if (undo.epVictimSq !== -1) {
    board[undo.epVictimSq] = undo.savedEpVictim;
  }
  if (undo.rookFrom !== -1) {
    board[undo.rookFrom] = undo.savedRook;
    board[undo.rookTo] = null;
  }
}

function generatePseudoMovesSearch(
  board: readonly (Piece | null)[],
  turn: Color,
  castling: CastlingRights,
  enPassantSq: number | null,
  capturesOnly: boolean,
): Move[] {
  const moves: Move[] = [];
  const enemy = opponentColor(turn);

  for (let sq = 0; sq < 64; sq += 1) {
    const piece = board[sq];
    if (!piece || piece.color !== turn) continue;
    const { row, col } = sqToRowCol(sq);

    if (piece.type === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const startRow = turn === 'w' ? 6 : 1;
      const promoRow = turn === 'w' ? 0 : 7;
      const oneRow = row + dir;

      if (oneRow >= 0 && oneRow < 8) {
        const oneSq = rowColToSq(oneRow, col);
        if (!board[oneSq]) {
          if (oneRow === promoRow) {
            for (const promo of PROMO_TYPES) {
              moves.push({ from: sq, to: oneSq, piece: 'p', color: turn, promotion: promo });
            }
          } else if (!capturesOnly) {
            moves.push({ from: sq, to: oneSq, piece: 'p', color: turn });
            if (row === startRow) {
              const twoSq = rowColToSq(row + dir * 2, col);
              if (!board[twoSq]) {
                moves.push({ from: sq, to: twoSq, piece: 'p', color: turn });
              }
            }
          }
        }

        for (const dc of [-1, 1]) {
          const nc = col + dc;
          if (nc < 0 || nc >= 8) continue;
          const capSq = rowColToSq(oneRow, nc);
          const target = board[capSq];
          if (target && target.color === enemy) {
            if (oneRow === promoRow) {
              for (const promo of PROMO_TYPES) {
                moves.push({
                  from: sq,
                  to: capSq,
                  piece: 'p',
                  color: turn,
                  captured: target.type,
                  promotion: promo,
                });
              }
            } else {
              moves.push({
                from: sq,
                to: capSq,
                piece: 'p',
                color: turn,
                captured: target.type,
              });
            }
          } else if (enPassantSq !== null && capSq === enPassantSq) {
            const epVictim = board[rowColToSq(row, nc)];
            if (epVictim && epVictim.color === enemy && epVictim.type === 'p') {
              moves.push({
                from: sq,
                to: capSq,
                piece: 'p',
                color: turn,
                captured: 'p',
                isEnPassant: true,
              });
            }
          }
        }
      }
    } else if (piece.type === 'n') {
      for (const [dr, dc] of KNIGHT_DELTAS) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
        const to = rowColToSq(nr, nc);
        const target = board[to];
        if (target) {
          if (target.color === enemy) {
            moves.push({ from: sq, to, piece: 'n', color: turn, captured: target.type });
          }
        } else if (!capturesOnly) {
          moves.push({ from: sq, to, piece: 'n', color: turn });
        }
      }
    } else if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
      const dirs =
        piece.type === 'b' ? BISHOP_DIRS : piece.type === 'r' ? ROOK_DIRS : QUEEN_DIRS;
      for (const [dr, dc] of dirs) {
        let nr = row + dr;
        let nc = col + dc;
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          const to = rowColToSq(nr, nc);
          const target = board[to];
          if (target) {
            if (target.color === enemy) {
              moves.push({
                from: sq,
                to,
                piece: piece.type,
                color: turn,
                captured: target.type,
              });
            }
            break;
          }
          if (!capturesOnly) {
            moves.push({ from: sq, to, piece: piece.type, color: turn });
          }
          nr += dr;
          nc += dc;
        }
      }
    } else if (piece.type === 'k') {
      for (const [dr, dc] of KING_DELTAS) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
        const to = rowColToSq(nr, nc);
        const target = board[to];
        if (target) {
          if (target.color === enemy) {
            moves.push({ from: sq, to, piece: 'k', color: turn, captured: target.type });
          }
        } else if (!capturesOnly) {
          moves.push({ from: sq, to, piece: 'k', color: turn });
        }
      }

      if (!capturesOnly) {
        const backRow = turn === 'w' ? 7 : 0;
        const homeKingSq = rowColToSq(backRow, 4);
        if (sq === homeKingSq && !isSquareAttacked(board, homeKingSq, enemy)) {
          if (turn === 'w' ? castling.wK : castling.bK) {
            const rook = board[rowColToSq(backRow, 7)];
            const fSq = rowColToSq(backRow, 5);
            const gSq = rowColToSq(backRow, 6);
            if (
              rook &&
              rook.color === turn &&
              rook.type === 'r' &&
              !board[fSq] &&
              !board[gSq] &&
              !isSquareAttacked(board, fSq, enemy) &&
              !isSquareAttacked(board, gSq, enemy)
            ) {
              moves.push({ from: sq, to: gSq, piece: 'k', color: turn, isCastling: 'K' });
            }
          }
          if (turn === 'w' ? castling.wQ : castling.bQ) {
            const rook = board[rowColToSq(backRow, 0)];
            const bSq = rowColToSq(backRow, 1);
            const cSq = rowColToSq(backRow, 2);
            const dSq = rowColToSq(backRow, 3);
            if (
              rook &&
              rook.color === turn &&
              rook.type === 'r' &&
              !board[bSq] &&
              !board[cSq] &&
              !board[dSq] &&
              !isSquareAttacked(board, dSq, enemy) &&
              !isSquareAttacked(board, cSq, enemy)
            ) {
              moves.push({ from: sq, to: cSq, piece: 'k', color: turn, isCastling: 'Q' });
            }
          }
        }
      }
    }
  }

  return moves;
}

function sameMove(a: Move, b: Move | null): boolean {
  return b !== null && a.from === b.from && a.to === b.to && a.promotion === b.promotion;
}

function scoreMoveOrdering(move: Move, pvMove: Move | null): number {
  if (sameMove(move, pvMove)) {
    return 1000000;
  }
  let score = 0;
  if (move.captured) {
    // MVV-LVA: Most Valuable Victim - Least Valuable Attacker
    score += 10000 + CENTIPAWN_VALUE[move.captured] * 16 - CENTIPAWN_VALUE[move.piece];
  }
  if (move.promotion) {
    score += 9000 + CENTIPAWN_VALUE[move.promotion];
  }
  if (move.isCastling) {
    score += 350;
  }
  // Encourage central squares for minor pieces and pawns
  const { row, col } = sqToRowCol(move.to);
  const centerDist = Math.abs(row - 3.5) + Math.abs(col - 3.5);
  score += Math.round((7 - centerDist) * 6);
  return score;
}

function orderMoves(moves: Move[], pvMove: Move | null): void {
  moves.sort((a, b) => scoreMoveOrdering(b, pvMove) - scoreMoveOrdering(a, pvMove));
}

interface SearchContext {
  nodes: number;
  deadlineMs: number;
  aborted: boolean;
}

function quiesce(
  board: (Piece | null)[],
  turn: Color,
  castling: CastlingRights,
  enPassantSq: number | null,
  alpha: number,
  beta: number,
  ply: number,
  qDepth: number,
  ctx: SearchContext,
): number {
  ctx.nodes += 1;
  if ((ctx.nodes & 511) === 0 && Date.now() >= ctx.deadlineMs) {
    ctx.aborted = true;
    return 0;
  }

  const sideSign = turn === 'w' ? 1 : -1;
  const inCheck = isKingInCheck(board, turn);

  if (!inCheck) {
    const standPat = sideSign * evaluateRawBoard(board);
    if (standPat >= beta) {
      return beta;
    }
    if (standPat > alpha) {
      alpha = standPat;
    }
    if (qDepth <= 0) {
      return alpha;
    }

    const captures = generatePseudoMovesSearch(board, turn, castling, enPassantSq, true);
    orderMoves(captures, null);

    for (const move of captures) {
      // Delta pruning for hopeless non-promotion captures
      if (!move.promotion && move.captured) {
        if (standPat + CENTIPAWN_VALUE[move.captured] + 200 < alpha) {
          continue;
        }
      }
      const undo = applyMoveInPlace(board, castling, move);
      const kingSq = findKingSquare(board, turn);
      if (kingSq === -1 || isSquareAttacked(board, kingSq, opponentColor(turn))) {
        unapplyMoveInPlace(board, move, undo);
        continue;
      }

      const nextEp =
        move.piece === 'p' && Math.abs(sqToRowCol(move.from).row - sqToRowCol(move.to).row) === 2
          ? ((move.from + move.to) >> 1)
          : null;
      const score = -quiesce(
        board,
        opponentColor(turn),
        undo.nextCastling,
        nextEp,
        -beta,
        -alpha,
        ply + 1,
        qDepth - 1,
        ctx,
      );
      unapplyMoveInPlace(board, move, undo);

      if (ctx.aborted) return 0;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  // When in check during quiescence, search all evasions up to qDepth > 0 so mates aren't missed
  if (qDepth <= 0) {
    return sideSign * evaluateRawBoard(board) - 25;
  }

  const evasions = generatePseudoMovesSearch(board, turn, castling, enPassantSq, false);
  orderMoves(evasions, null);
  let legalCount = 0;

  for (const move of evasions) {
    const undo = applyMoveInPlace(board, castling, move);
    const kingSq = findKingSquare(board, turn);
    if (kingSq === -1 || isSquareAttacked(board, kingSq, opponentColor(turn))) {
      unapplyMoveInPlace(board, move, undo);
      continue;
    }
    legalCount += 1;
    const nextEp =
      move.piece === 'p' && Math.abs(sqToRowCol(move.from).row - sqToRowCol(move.to).row) === 2
        ? ((move.from + move.to) >> 1)
        : null;
    const score = -quiesce(
      board,
      opponentColor(turn),
      undo.nextCastling,
      nextEp,
      -beta,
      -alpha,
      ply + 1,
      qDepth - 1,
      ctx,
    );
    unapplyMoveInPlace(board, move, undo);

    if (ctx.aborted) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  if (legalCount === 0) {
    return -(MATE_SCORE - ply);
  }
  return alpha;
}

function negamax(
  board: (Piece | null)[],
  turn: Color,
  castling: CastlingRights,
  enPassantSq: number | null,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  useQuiescence: boolean,
  ctx: SearchContext,
): number {
  ctx.nodes += 1;
  if ((ctx.nodes & 511) === 0 && Date.now() >= ctx.deadlineMs) {
    ctx.aborted = true;
    return 0;
  }

  if (depth <= 0) {
    if (useQuiescence) {
      return quiesce(board, turn, castling, enPassantSq, alpha, beta, ply, 4, ctx);
    }
    const sideSign = turn === 'w' ? 1 : -1;
    return sideSign * evaluateRawBoard(board);
  }

  const pseudo = generatePseudoMovesSearch(board, turn, castling, enPassantSq, false);
  orderMoves(pseudo, null);

  let legalCount = 0;
  let best = -INFINITY_SCORE;

  for (const move of pseudo) {
    const undo = applyMoveInPlace(board, castling, move);
    const kingSq = findKingSquare(board, turn);
    if (kingSq === -1 || isSquareAttacked(board, kingSq, opponentColor(turn))) {
      unapplyMoveInPlace(board, move, undo);
      continue;
    }

    legalCount += 1;
    const nextEp =
      move.piece === 'p' && Math.abs(sqToRowCol(move.from).row - sqToRowCol(move.to).row) === 2
        ? ((move.from + move.to) >> 1)
        : null;

    const score = -negamax(
      board,
      opponentColor(turn),
      undo.nextCastling,
      nextEp,
      depth - 1,
      -beta,
      -alpha,
      ply + 1,
      useQuiescence,
      ctx,
    );
    unapplyMoveInPlace(board, move, undo);

    if (ctx.aborted) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }

  if (legalCount === 0) {
    return isKingInCheck(board, turn) ? -(MATE_SCORE - ply) : 0;
  }

  return best;
}

function searchRoot(
  board: (Piece | null)[],
  turn: Color,
  castling: CastlingRights,
  legalMoves: Move[],
  depth: number,
  useQuiescence: boolean,
  pvMove: Move | null,
  ctx: SearchContext,
): { move: Move; score: number } | null {
  const ordered = legalMoves.map((m) => ({ ...m }));
  orderMoves(ordered, pvMove);

  let bestMove = ordered[0];
  let bestScore = -INFINITY_SCORE;
  let alpha = -INFINITY_SCORE;
  const beta = INFINITY_SCORE;

  for (const move of ordered) {
    const undo = applyMoveInPlace(board, castling, move);
    const nextEp =
      move.piece === 'p' && Math.abs(sqToRowCol(move.from).row - sqToRowCol(move.to).row) === 2
        ? ((move.from + move.to) >> 1)
        : null;

    const score = -negamax(
      board,
      opponentColor(turn),
      undo.nextCastling,
      nextEp,
      depth - 1,
      -beta,
      -alpha,
      1,
      useQuiescence,
      ctx,
    );
    unapplyMoveInPlace(board, move, undo);

    if (ctx.aborted) {
      return null;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) {
      alpha = score;
    }
  }

  return { move: bestMove, score: bestScore };
}

/**
 * Selects the best legal move for the active side at the requested difficulty.
 * - `novice`: Depth 1 + mild random jitter on non-mate moves (still takes hanging queens & mate-in-1)
 * - `club`: Depth 2 alpha-beta + capture quiescence
 * - `master`: Depth 3 iterative deepening alpha-beta + MVV-LVA + PST + quiescence (< 300ms)
 */
export function chooseBestMove(
  state: ChessState,
  difficulty: Difficulty = 'club',
): Move | null {
  if (state.status !== 'active') {
    return null;
  }

  const board = cloneBoard(state.board);
  const legalMoves = generateLegalMoves(board, state.turn, state.castling, state.enPassantSq);
  if (legalMoves.length === 0) {
    return null;
  }
  if (legalMoves.length === 1) {
    return { ...legalMoves[0] };
  }

  if (difficulty === 'novice') {
    let bestMove = legalMoves[0];
    let bestScore = -INFINITY_SCORE;
    const ctx: SearchContext = {
      nodes: 0,
      deadlineMs: Date.now() + 1000,
      aborted: false,
    };

    for (const move of legalMoves) {
      const undo = applyMoveInPlace(board, state.castling, move);
      const nextEp =
        move.piece === 'p' && Math.abs(sqToRowCol(move.from).row - sqToRowCol(move.to).row) === 2
          ? ((move.from + move.to) >> 1)
          : null;
      let score = -negamax(
        board,
        opponentColor(state.turn),
        undo.nextCastling,
        nextEp,
        0,
        -INFINITY_SCORE,
        INFINITY_SCORE,
        1,
        false,
        ctx,
      );
      // Verify immediate mate-in-1 so Novice always spots forced mate
      const opp = opponentColor(state.turn);
      if (isKingInCheck(board, opp)) {
        const oppReplies = generateLegalMoves(board, opp, undo.nextCastling, nextEp);
        if (oppReplies.length === 0) {
          score = MATE_SCORE - 1;
        }
      }
      unapplyMoveInPlace(board, move, undo);

      // Keep checkmates & large captures intact, add mild jitter on quiet positional moves
      const isDecisive = Math.abs(score) >= MATE_SCORE - 100;
      const noisyScore = isDecisive ? score : score + (Math.random() - 0.5) * 45;
      if (noisyScore > bestScore) {
        bestScore = noisyScore;
        bestMove = move;
      }
    }

    return { ...bestMove };
  }

  if (difficulty === 'club') {
    const ctx: SearchContext = {
      nodes: 0,
      deadlineMs: Date.now() + 200,
      aborted: false,
    };
    const res = searchRoot(
      board,
      state.turn,
      state.castling,
      legalMoves,
      2,
      true,
      null,
      ctx,
    );
    return res ? { ...res.move } : { ...legalMoves[0] };
  }

  // Master: iterative deepening depth 1 -> 2 -> 3 with < 240ms budget
  const deadlineMs = Date.now() + MASTER_TIME_BUDGET_MS;
  let bestMove = legalMoves[0];
  let pvMove: Move | null = null;

  for (let depth = 1; depth <= 3; depth += 1) {
    const ctx: SearchContext = {
      nodes: 0,
      deadlineMs: depth === 1 ? Date.now() + 1000 : deadlineMs,
      aborted: false,
    };
    const res = searchRoot(
      board,
      state.turn,
      state.castling,
      legalMoves,
      depth,
      true,
      pvMove,
      ctx,
    );
    if (!res) {
      break;
    }
    bestMove = res.move;
    pvMove = res.move;
    if (res.score >= MATE_SCORE - 10) {
      break;
    }
  }

  return { ...bestMove };
}
