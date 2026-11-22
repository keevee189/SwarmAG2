/**
 * Pure TypeScript Chess Engine ("Grandmaster Protocol")
 * Full FIDE rules: all 6 piece types, absolute pin filtering, check detection,
 * kingside/queenside castling, en passant (with horizontal pin verification),
 * pawn promotion, checkmate, stalemate, insufficient material, threefold repetition,
 * 50-move rule, SAN algebraic notation, FEN import/export, and full undo stack.
 *
 * Zero DOM dependencies.
 */

import type {
  CastlingRights,
  ChessState,
  Color,
  GameStatus,
  MaterialSummary,
  Move,
  Piece,
  PieceType,
  PromotionPieceType,
  RecordedMove,
} from './types.js';

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export const PIECE_MATERIAL_VALUE: Record<PieceType, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const PROMOTION_TYPES: readonly PromotionPieceType[] = ['q', 'r', 'b', 'n'];

const KNIGHT_DELTAS: readonly [number, number][] = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

const KING_DELTAS: readonly [number, number][] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const BISHOP_DIRS: readonly [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const ROOK_DIRS: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const QUEEN_DIRS: readonly [number, number][] = [...BISHOP_DIRS, ...ROOK_DIRS];

interface UndoSnapshot {
  board: (Piece | null)[];
  turn: Color;
  castling: CastlingRights;
  enPassantSq: number | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  capturedByWhite: PieceType[];
  capturedByBlack: PieceType[];
  positionCounts: Record<string, number>;
  status: GameStatus;
  winner: Color | 'draw' | null;
  inCheck: boolean;
  recorded: RecordedMove;
}

export interface MoveInput {
  from: number | string;
  to: number | string;
  promotion?: PromotionPieceType;
}

export function opponentColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export function isValidSq(sq: number): boolean {
  return Number.isInteger(sq) && sq >= 0 && sq < 64;
}

export function sqToRowCol(sq: number): { row: number; col: number } {
  return { row: sq >> 3, col: sq & 7 };
}

export function rowColToSq(row: number, col: number): number {
  return (row << 3) | col;
}

export function sqToAlgebraic(sq: number): string {
  const { row, col } = sqToRowCol(sq);
  return `${FILES[col]}${8 - row}`;
}

export function algebraicToSq(coord: string): number {
  if (coord.length !== 2) {
    return -1;
  }
  const col = FILES.indexOf(coord[0].toLowerCase() as (typeof FILES)[number]);
  const rank = Number(coord[1]);
  if (col === -1 || !Number.isInteger(rank) || rank < 1 || rank > 8) {
    return -1;
  }
  const row = 8 - rank;
  return rowColToSq(row, col);
}

function resolveSquare(sqOrCoord: number | string): number {
  return typeof sqOrCoord === 'number' ? sqOrCoord : algebraicToSq(sqOrCoord);
}

export function cloneBoard(board: readonly (Piece | null)[]): (Piece | null)[] {
  return board.map((p) => (p ? { color: p.color, type: p.type } : null));
}

export function cloneCastling(c: CastlingRights): CastlingRights {
  return { wK: c.wK, wQ: c.wQ, bK: c.bK, bQ: c.bQ };
}

export function findKingSquare(board: readonly (Piece | null)[], color: Color): number {
  for (let i = 0; i < 64; i += 1) {
    const p = board[i];
    if (p && p.color === color && p.type === 'k') {
      return i;
    }
  }
  return -1;
}

export function isSquareAttacked(
  board: readonly (Piece | null)[],
  targetSq: number,
  byColor: Color,
): boolean {
  const { row, col } = sqToRowCol(targetSq);

  // Pawns: if attacker is White (moves up: row - 1), white pawn attacks from row + 1
  const pawnSourceRow = byColor === 'w' ? row + 1 : row - 1;
  if (pawnSourceRow >= 0 && pawnSourceRow < 8) {
    for (const dc of [-1, 1]) {
      const nc = col + dc;
      if (nc >= 0 && nc < 8) {
        const p = board[rowColToSq(pawnSourceRow, nc)];
        if (p && p.color === byColor && p.type === 'p') {
          return true;
        }
      }
    }
  }

  // Knights
  for (const [dr, dc] of KNIGHT_DELTAS) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[rowColToSq(nr, nc)];
      if (p && p.color === byColor && p.type === 'n') {
        return true;
      }
    }
  }

  // Adjacent king
  for (const [dr, dc] of KING_DELTAS) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[rowColToSq(nr, nc)];
      if (p && p.color === byColor && p.type === 'k') {
        return true;
      }
    }
  }

  // Diagonal rays (bishop / queen)
  for (const [dr, dc] of BISHOP_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[rowColToSq(nr, nc)];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) {
          return true;
        }
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  // Orthogonal rays (rook / queen)
  for (const [dr, dc] of ROOK_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[rowColToSq(nr, nc)];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) {
          return true;
        }
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  return false;
}

export function isKingInCheck(board: readonly (Piece | null)[], color: Color): boolean {
  const kingSq = findKingSquare(board, color);
  if (kingSq === -1) {
    return false;
  }
  return isSquareAttacked(board, kingSq, opponentColor(color));
}

function generatePseudoLegalMoves(
  board: readonly (Piece | null)[],
  turn: Color,
  castling: CastlingRights,
  enPassantSq: number | null,
): Move[] {
  const moves: Move[] = [];
  const enemy = opponentColor(turn);

  for (let sq = 0; sq < 64; sq += 1) {
    const piece = board[sq];
    if (!piece || piece.color !== turn) {
      continue;
    }

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
            for (const promo of PROMOTION_TYPES) {
              moves.push({ from: sq, to: oneSq, piece: 'p', color: turn, promotion: promo });
            }
          } else {
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
          if (nc < 0 || nc >= 8) {
            continue;
          }
          const capSq = rowColToSq(oneRow, nc);
          const target = board[capSq];
          if (target && target.color === enemy) {
            if (oneRow === promoRow) {
              for (const promo of PROMOTION_TYPES) {
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
            const epVictimSq = rowColToSq(row, nc);
            const epVictim = board[epVictimSq];
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
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) {
          continue;
        }
        const to = rowColToSq(nr, nc);
        const target = board[to];
        if (!target) {
          moves.push({ from: sq, to, piece: 'n', color: turn });
        } else if (target.color === enemy) {
          moves.push({ from: sq, to, piece: 'n', color: turn, captured: target.type });
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
          if (!target) {
            moves.push({ from: sq, to, piece: piece.type, color: turn });
          } else {
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
          nr += dr;
          nc += dc;
        }
      }
    } else if (piece.type === 'k') {
      for (const [dr, dc] of KING_DELTAS) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) {
          continue;
        }
        const to = rowColToSq(nr, nc);
        const target = board[to];
        if (!target) {
          moves.push({ from: sq, to, piece: 'k', color: turn });
        } else if (target.color === enemy) {
          moves.push({ from: sq, to, piece: 'k', color: turn, captured: target.type });
        }
      }

      // Castling checks
      const backRow = turn === 'w' ? 7 : 0;
      const homeKingSq = rowColToSq(backRow, 4);
      if (sq === homeKingSq && !isSquareAttacked(board, homeKingSq, enemy)) {
        const canKingside = turn === 'w' ? castling.wK : castling.bK;
        if (canKingside) {
          const rookSq = rowColToSq(backRow, 7);
          const rook = board[rookSq];
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

        const canQueenside = turn === 'w' ? castling.wQ : castling.bQ;
        if (canQueenside) {
          const rookSq = rowColToSq(backRow, 0);
          const rook = board[rookSq];
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

  return moves;
}

/**
 * Checks if executing `move` leaves `move.color`'s king safe from attack.
 * Temporarily mutates and restores `board` in-place with zero allocations.
 */
function isMoveLegalOnBoard(board: (Piece | null)[], move: Move): boolean {
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

  const legal = !isKingInCheck(board, move.color);

  board[move.from] = savedFrom;
  board[move.to] = savedTo;
  if (epVictimSq !== -1) {
    board[epVictimSq] = savedEpVictim;
  }
  if (rookFrom !== -1) {
    board[rookFrom] = savedRook;
    board[rookTo] = null;
  }

  return legal;
}

export function generateLegalMoves(
  board: (Piece | null)[],
  turn: Color,
  castling: CastlingRights,
  enPassantSq: number | null,
): Move[] {
  const pseudo = generatePseudoLegalMoves(board, turn, castling, enPassantSq);
  return pseudo.filter((move) => isMoveLegalOnBoard(board, move));
}

export function isInsufficientMaterial(board: readonly (Piece | null)[]): boolean {
  const whiteMinors: { type: PieceType; squareColor: number }[] = [];
  const blackMinors: { type: PieceType; squareColor: number }[] = [];

  for (let sq = 0; sq < 64; sq += 1) {
    const p = board[sq];
    if (!p || p.type === 'k') {
      continue;
    }
    if (p.type === 'p' || p.type === 'r' || p.type === 'q') {
      return false;
    }
    const { row, col } = sqToRowCol(sq);
    const entry = { type: p.type, squareColor: (row + col) & 1 };
    if (p.color === 'w') {
      whiteMinors.push(entry);
    } else {
      blackMinors.push(entry);
    }
  }

  if (whiteMinors.length === 0 && blackMinors.length === 0) {
    return true;
  }
  if (whiteMinors.length === 1 && blackMinors.length === 0) {
    return whiteMinors[0].type === 'n' || whiteMinors[0].type === 'b';
  }
  if (blackMinors.length === 1 && whiteMinors.length === 0) {
    return blackMinors[0].type === 'n' || blackMinors[0].type === 'b';
  }
  if (
    whiteMinors.length === 1 &&
    blackMinors.length === 1 &&
    whiteMinors[0].type === 'b' &&
    blackMinors[0].type === 'b' &&
    whiteMinors[0].squareColor === blackMinors[0].squareColor
  ) {
    return true;
  }

  return false;
}

export function getMaterialSummary(board: readonly (Piece | null)[]): MaterialSummary {
  let white = 0;
  let black = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = board[sq];
    if (!p) {
      continue;
    }
    const val = PIECE_MATERIAL_VALUE[p.type];
    if (p.color === 'w') {
      white += val;
    } else {
      black += val;
    }
  }
  return { white, black, diff: white - black };
}

function encodeBoardPlacement(board: readonly (Piece | null)[]): string {
  const rows: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    let empty = 0;
    let rowStr = '';
    for (let col = 0; col < 8; col += 1) {
      const p = board[rowColToSq(row, col)];
      if (!p) {
        empty += 1;
      } else {
        if (empty > 0) {
          rowStr += String(empty);
          empty = 0;
        }
        rowStr += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
    }
    if (empty > 0) {
      rowStr += String(empty);
    }
    rows.push(rowStr);
  }
  return rows.join('/');
}

function encodeCastling(castling: CastlingRights): string {
  let s = '';
  if (castling.wK) s += 'K';
  if (castling.wQ) s += 'Q';
  if (castling.bK) s += 'k';
  if (castling.bQ) s += 'q';
  return s || '-';
}

function computePositionKey(
  board: (Piece | null)[],
  turn: Color,
  castling: CastlingRights,
  enPassantSq: number | null,
  legalMoves: readonly Move[],
): string {
  const placement = encodeBoardPlacement(board);
  const castleStr = encodeCastling(castling);
  const hasLegalEp =
    enPassantSq !== null && legalMoves.some((m) => m.isEnPassant === true);
  const epStr = hasLegalEp && enPassantSq !== null ? sqToAlgebraic(enPassantSq) : '-';
  return `${placement} ${turn} ${castleStr} ${epStr}`;
}

function formatSan(
  move: Move,
  legalMovesBefore: readonly Move[],
  isCheckAfter: boolean,
  isCheckmateAfter: boolean,
): string {
  let san = '';

  if (move.isCastling === 'K') {
    san = 'O-O';
  } else if (move.isCastling === 'Q') {
    san = 'O-O-O';
  } else if (move.piece === 'p') {
    const dest = sqToAlgebraic(move.to);
    if (move.captured || move.isEnPassant) {
      const fromFile = FILES[sqToRowCol(move.from).col];
      san = `${fromFile}x${dest}`;
    } else {
      san = dest;
    }
    if (move.promotion) {
      san += `=${move.promotion.toUpperCase()}`;
    }
  } else {
    const pieceLetter = move.piece.toUpperCase();
    const { row: fromRow, col: fromCol } = sqToRowCol(move.from);
    const sameTypePeers = legalMovesBefore.filter(
      (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from,
    );
    let disambig = '';
    if (sameTypePeers.length > 0) {
      const sameFile = sameTypePeers.some((m) => sqToRowCol(m.from).col === fromCol);
      const sameRank = sameTypePeers.some((m) => sqToRowCol(m.from).row === fromRow);
      if (!sameFile) {
        disambig = FILES[fromCol];
      } else if (!sameRank) {
        disambig = String(8 - fromRow);
      } else {
        disambig = sqToAlgebraic(move.from);
      }
    }
    const captureMark = move.captured ? 'x' : '';
    san = `${pieceLetter}${disambig}${captureMark}${sqToAlgebraic(move.to)}`;
  }

  if (isCheckmateAfter) {
    san += '#';
  } else if (isCheckAfter) {
    san += '+';
  }

  return san;
}

/**
 * Stateful FIDE-compliant Chess Engine with full undo stack and FEN support.
 */
export class ChessEngine {
  private board: (Piece | null)[] = new Array(64).fill(null);
  private turn: Color = 'w';
  private castling: CastlingRights = { wK: true, wQ: true, bK: true, bQ: true };
  private enPassantSq: number | null = null;
  private halfmoveClock = 0;
  private fullmoveNumber = 1;
  private history: RecordedMove[] = [];
  private capturedByWhite: PieceType[] = [];
  private capturedByBlack: PieceType[] = [];
  private positionCounts: Record<string, number> = {};
  private status: GameStatus = 'active';
  private winner: Color | 'draw' | null = null;
  private inCheck = false;
  private cachedLegalMoves: Move[] = [];
  private undoStack: UndoSnapshot[] = [];

  constructor(fen: string = INITIAL_FEN) {
    this.loadFen(fen);
  }

  public reset(fen: string = INITIAL_FEN): void {
    this.loadFen(fen);
  }

  public loadFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) {
      throw new Error(`Invalid FEN: "${fen}"`);
    }

    const [placement, activeColor, castlingStr, epStr, halfStr, fullStr] = parts;
    const ranks = placement.split('/');
    if (ranks.length !== 8) {
      throw new Error(`Invalid FEN board placement: "${placement}"`);
    }

    const nextBoard: (Piece | null)[] = new Array(64).fill(null);
    for (let row = 0; row < 8; row += 1) {
      let col = 0;
      for (const ch of ranks[row]) {
        const digit = Number(ch);
        if (Number.isInteger(digit) && digit >= 1 && digit <= 8) {
          col += digit;
        } else {
          const lower = ch.toLowerCase();
          if (!['p', 'n', 'b', 'r', 'q', 'k'].includes(lower)) {
            throw new Error(`Invalid FEN piece "${ch}"`);
          }
          if (col >= 8) {
            throw new Error(`FEN rank overflow in "${ranks[row]}"`);
          }
          const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
          nextBoard[rowColToSq(row, col)] = { color, type: lower as PieceType };
          col += 1;
        }
      }
      if (col !== 8) {
        throw new Error(`FEN rank incomplete in "${ranks[row]}"`);
      }
    }

    if (activeColor !== 'w' && activeColor !== 'b') {
      throw new Error(`Invalid FEN turn "${activeColor}"`);
    }

    const nextCastling: CastlingRights = {
      wK: castlingStr.includes('K'),
      wQ: castlingStr.includes('Q'),
      bK: castlingStr.includes('k'),
      bQ: castlingStr.includes('q'),
    };

    const nextEp = epStr === '-' ? null : algebraicToSq(epStr);
    if (epStr !== '-' && nextEp === -1) {
      throw new Error(`Invalid FEN en passant square "${epStr}"`);
    }

    const parsedHalf = halfStr !== undefined ? Number(halfStr) : 0;
    const parsedFull = fullStr !== undefined ? Number(fullStr) : 1;

    this.board = nextBoard;
    this.turn = activeColor;
    this.castling = nextCastling;
    this.enPassantSq = nextEp;
    this.halfmoveClock = Number.isFinite(parsedHalf) && parsedHalf >= 0 ? parsedHalf : 0;
    this.fullmoveNumber = Number.isFinite(parsedFull) && parsedFull >= 1 ? parsedFull : 1;
    this.history = [];
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    this.positionCounts = {};
    this.undoStack = [];

    this.recomputeStatusAndLegalMoves(true);
  }

  public toFen(): string {
    const placement = encodeBoardPlacement(this.board);
    const castleStr = encodeCastling(this.castling);
    const epStr = this.enPassantSq !== null ? sqToAlgebraic(this.enPassantSq) : '-';
    return `${placement} ${this.turn} ${castleStr} ${epStr} ${this.halfmoveClock} ${this.fullmoveNumber}`;
  }

  public getState(): ChessState {
    return {
      board: cloneBoard(this.board),
      turn: this.turn,
      castling: cloneCastling(this.castling),
      enPassantSq: this.enPassantSq,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      history: this.history.map((item) => ({
        ...item,
        move: { ...item.move },
      })),
      capturedByWhite: [...this.capturedByWhite],
      capturedByBlack: [...this.capturedByBlack],
      positionCounts: { ...this.positionCounts },
      status: this.status,
      winner: this.winner,
      inCheck: this.inCheck,
    };
  }

  public getTurn(): Color {
    return this.turn;
  }

  public getStatus(): GameStatus {
    return this.status;
  }

  public getWinner(): Color | 'draw' | null {
    return this.winner;
  }

  public isInCheck(): boolean {
    return this.inCheck;
  }

  public isGameOver(): boolean {
    return this.status !== 'active';
  }

  public getPieceAt(sqOrCoord: number | string): Piece | null {
    const sq = resolveSquare(sqOrCoord);
    if (!isValidSq(sq)) {
      return null;
    }
    const p = this.board[sq];
    return p ? { color: p.color, type: p.type } : null;
  }

  public getLegalMoves(): Move[] {
    if (this.status !== 'active') {
      return [];
    }
    return this.cachedLegalMoves.map((m) => ({ ...m }));
  }

  public getLegalMovesFrom(sqOrCoord: number | string): Move[] {
    if (this.status !== 'active') {
      return [];
    }
    const sq = resolveSquare(sqOrCoord);
    if (!isValidSq(sq)) {
      return [];
    }
    return this.cachedLegalMoves.filter((m) => m.from === sq).map((m) => ({ ...m }));
  }

  public getHistory(): RecordedMove[] {
    return this.history.map((item) => ({ ...item, move: { ...item.move } }));
  }

  public getMaterialSummary(): MaterialSummary {
    return getMaterialSummary(this.board);
  }

  public makeMove(input: Move | MoveInput): RecordedMove | null {
    if (this.status !== 'active') {
      return null;
    }

    const from = resolveSquare(input.from);
    const to = resolveSquare(input.to);
    if (!isValidSq(from) || !isValidSq(to)) {
      return null;
    }

    const legalMovesBefore = this.cachedLegalMoves;
    const matchedMove = legalMovesBefore.find((m) => {
      if (m.from !== from || m.to !== to) {
        return false;
      }
      if (input.promotion !== undefined) {
        return m.promotion === input.promotion;
      }
      return m.promotion === undefined;
    });

    if (!matchedMove) {
      return null;
    }

    const snapshot: UndoSnapshot = {
      board: cloneBoard(this.board),
      turn: this.turn,
      castling: cloneCastling(this.castling),
      enPassantSq: this.enPassantSq,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      capturedByWhite: [...this.capturedByWhite],
      capturedByBlack: [...this.capturedByBlack],
      positionCounts: { ...this.positionCounts },
      status: this.status,
      winner: this.winner,
      inCheck: this.inCheck,
      recorded: {
        move: { ...matchedMove },
        san: '',
        moveNumber: this.fullmoveNumber,
        color: this.turn,
        fen: '',
      },
    };

    const movingPiece = this.board[matchedMove.from];
    if (!movingPiece) {
      return null;
    }

    // Apply piece relocation & promotion
    this.board[matchedMove.to] = matchedMove.promotion
      ? { color: matchedMove.color, type: matchedMove.promotion }
      : movingPiece;
    this.board[matchedMove.from] = null;

    // Handle en passant capture
    if (matchedMove.isEnPassant) {
      const victimSq = matchedMove.color === 'w' ? matchedMove.to + 8 : matchedMove.to - 8;
      this.board[victimSq] = null;
    }

    // Handle castling rook shift
    if (matchedMove.isCastling) {
      const backRow = matchedMove.color === 'w' ? 7 : 0;
      const rookFrom =
        matchedMove.isCastling === 'K' ? rowColToSq(backRow, 7) : rowColToSq(backRow, 0);
      const rookTo =
        matchedMove.isCastling === 'K' ? rowColToSq(backRow, 5) : rowColToSq(backRow, 3);
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = null;
    }

    // Track captured material
    if (matchedMove.captured) {
      if (matchedMove.color === 'w') {
        this.capturedByWhite.push(matchedMove.captured);
      } else {
        this.capturedByBlack.push(matchedMove.captured);
      }
    }

    // Revoke castling rights when king/rook moves or corner rook is captured
    if (matchedMove.piece === 'k') {
      if (matchedMove.color === 'w') {
        this.castling.wK = false;
        this.castling.wQ = false;
      } else {
        this.castling.bK = false;
        this.castling.bQ = false;
      }
    }
    if (matchedMove.from === 63 || matchedMove.to === 63) this.castling.wK = false;
    if (matchedMove.from === 56 || matchedMove.to === 56) this.castling.wQ = false;
    if (matchedMove.from === 7 || matchedMove.to === 7) this.castling.bK = false;
    if (matchedMove.from === 0 || matchedMove.to === 0) this.castling.bQ = false;

    // Update en passant square
    const { row: fromRow, col: fromCol } = sqToRowCol(matchedMove.from);
    const { row: toRow } = sqToRowCol(matchedMove.to);
    if (matchedMove.piece === 'p' && Math.abs(fromRow - toRow) === 2) {
      this.enPassantSq = rowColToSq((fromRow + toRow) >> 1, fromCol);
    } else {
      this.enPassantSq = null;
    }

    // Update clocks
    if (matchedMove.piece === 'p' || matchedMove.captured !== undefined) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock += 1;
    }

    const moveNumberForRecord = this.fullmoveNumber;
    const moverColor = this.turn;
    if (this.turn === 'b') {
      this.fullmoveNumber += 1;
    }
    this.turn = opponentColor(this.turn);

    const nextStatus = this.recomputeStatusAndLegalMoves(true);

    const san = formatSan(
      matchedMove,
      legalMovesBefore,
      this.inCheck,
      nextStatus === 'checkmate',
    );
    const recorded: RecordedMove = {
      move: { ...matchedMove },
      san,
      moveNumber: moveNumberForRecord,
      color: moverColor,
      fen: this.toFen(),
    };
    snapshot.recorded = recorded;
    this.history.push(recorded);
    this.undoStack.push(snapshot);

    return { ...recorded, move: { ...recorded.move } };
  }

  public undo(): RecordedMove | null {
    const snap = this.undoStack.pop();
    if (!snap) {
      return null;
    }
    this.board = snap.board;
    this.turn = snap.turn;
    this.castling = snap.castling;
    this.enPassantSq = snap.enPassantSq;
    this.halfmoveClock = snap.halfmoveClock;
    this.fullmoveNumber = snap.fullmoveNumber;
    this.capturedByWhite = snap.capturedByWhite;
    this.capturedByBlack = snap.capturedByBlack;
    this.positionCounts = snap.positionCounts;
    this.status = snap.status;
    this.winner = snap.winner;
    this.inCheck = snap.inCheck;
    this.history.pop();
    this.cachedLegalMoves = generateLegalMoves(
      this.board,
      this.turn,
      this.castling,
      this.enPassantSq,
    );
    return snap.recorded;
  }

  private recomputeStatusAndLegalMoves(incrementRepetition: boolean): GameStatus {
    this.inCheck = isKingInCheck(this.board, this.turn);
    this.cachedLegalMoves = generateLegalMoves(
      this.board,
      this.turn,
      this.castling,
      this.enPassantSq,
    );

    const posKey = computePositionKey(
      this.board,
      this.turn,
      this.castling,
      this.enPassantSq,
      this.cachedLegalMoves,
    );
    if (incrementRepetition) {
      this.positionCounts[posKey] = (this.positionCounts[posKey] ?? 0) + 1;
    }

    if (this.cachedLegalMoves.length === 0) {
      if (this.inCheck) {
        this.status = 'checkmate';
        this.winner = opponentColor(this.turn);
      } else {
        this.status = 'stalemate';
        this.winner = 'draw';
      }
      return this.status;
    }

    if (isInsufficientMaterial(this.board)) {
      this.status = 'draw-insufficient';
      this.winner = 'draw';
      return this.status;
    }

    if ((this.positionCounts[posKey] ?? 0) >= 3) {
      this.status = 'draw-repetition';
      this.winner = 'draw';
      return this.status;
    }

    if (this.halfmoveClock >= 100) {
      this.status = 'draw-fifty-move';
      this.winner = 'draw';
      return this.status;
    }

    this.status = 'active';
    this.winner = null;
    return this.status;
  }
}
