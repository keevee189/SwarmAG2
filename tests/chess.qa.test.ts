import assert from 'node:assert/strict';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  chooseBestMove,
  evaluateBoard,
  predictWinner,
} from '../ts/games/chess/ai.js';
import {
  ChessEngine,
  INITIAL_FEN,
  sqToAlgebraic,
} from '../ts/games/chess/engine.js';
import type { ChessState, Difficulty } from '../ts/games/chess/types.js';
import { createAppServer } from '../ts/server.js';
import { withBrowserPage } from './helpers/cdp.js';

function resolveRepoRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'games', 'chess.html'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

function perft(engine: ChessEngine, depth: number): number {
  if (depth === 0) {
    return 1;
  }
  const moves = engine.getLegalMoves();
  if (depth === 1) {
    return moves.length;
  }
  let nodes = 0;
  for (const move of moves) {
    const rec = engine.makeMove(move);
    assert.ok(rec, `Expected legal move ${sqToAlgebraic(move.from)}->${sqToAlgebraic(move.to)} to succeed`);
    nodes += perft(engine, depth - 1);
    const undone = engine.undo();
    assert.ok(undone, 'Expected undo to succeed during perft traversal');
  }
  return nodes;
}

const INITIAL_BOARD_MAP: Record<string, string> = {
  a8: 'br', b8: 'bn', c8: 'bb', d8: 'bq', e8: 'bk', f8: 'bb', g8: 'bn', h8: 'br',
  a7: 'bp', b7: 'bp', c7: 'bp', d7: 'bp', e7: 'bp', f7: 'bp', g7: 'bp', h7: 'bp',
  a2: 'wp', b2: 'wp', c2: 'wp', d2: 'wp', e2: 'wp', f2: 'wp', g2: 'wp', h2: 'wp',
  a1: 'wr', b1: 'wn', c1: 'wb', d1: 'wq', e1: 'wk', f1: 'wb', g1: 'wn', h1: 'wr',
};

describe('Chess QA — Adversarial Rules, Perft & AI Verification', () => {
  it('matches exact Perft move-generation counts from starting position (depth 1=20, 2=400, 3=8902)', () => {
    const engine = new ChessEngine(INITIAL_FEN);
    assert.equal(perft(engine, 1), 20);
    assert.equal(perft(engine, 2), 400);
    assert.equal(perft(engine, 3), 8902);
    assert.equal(engine.toFen(), INITIAL_FEN);
    assert.equal(engine.getHistory().length, 0);
  });

  it('matches exact Perft counts on Kiwipete (depth 1=48, 2=2039) and Perft Position 3 (depth 1=14, 2=191, 3=2812)', () => {
    const kiwipeteFen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    const kiwipete = new ChessEngine(kiwipeteFen);
    assert.equal(perft(kiwipete, 1), 48);
    assert.equal(perft(kiwipete, 2), 2039);
    assert.equal(kiwipete.toFen(), kiwipeteFen);

    const pos3Fen = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
    const pos3 = new ChessEngine(pos3Fen);
    assert.equal(perft(pos3, 1), 14);
    assert.equal(perft(pos3, 2), 191);
    assert.equal(perft(pos3, 3), 2812);
    assert.equal(pos3.toFen(), pos3Fen);
  });

  it('revokes castling rights when untouched corner rooks are captured and allows castling when rook is attacked', () => {
    // Black bishop on c6 captures White untouched h1 rook -> revokes wK, preserves wQ
    const capWhiteH1 = new ChessEngine('4k3/8/2b5/8/8/8/8/R3K2R b KQ - 0 1');
    const rec1 = capWhiteH1.makeMove({ from: 'c6', to: 'h1' });
    assert.ok(rec1);
    assert.equal(capWhiteH1.getState().castling.wK, false);
    assert.equal(capWhiteH1.getState().castling.wQ, true);
    const whiteTargets = capWhiteH1.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(whiteTargets.includes('c1'), true);
    assert.equal(whiteTargets.includes('g1'), false);

    // Undo restores wK castling right
    capWhiteH1.undo();
    assert.equal(capWhiteH1.getState().castling.wK, true);
    assert.equal(capWhiteH1.getState().castling.wQ, true);

    // White bishop on c6 captures Black untouched a8 rook -> revokes bQ, preserves bK
    const capBlackA8 = new ChessEngine('r3k2r/8/2B5/8/8/8/8/4K3 w kq - 0 1');
    const rec2 = capBlackA8.makeMove({ from: 'c6', to: 'a8' });
    assert.ok(rec2);
    assert.equal(capBlackA8.getState().castling.bQ, false);
    assert.equal(capBlackA8.getState().castling.bK, true);

    // Castling remains legal even when the corner rook itself (a1) is attacked by Black rook on a8
    const castleWithAttackedRook = new ChessEngine('r3k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
    const kingMoves = castleWithAttackedRook.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(kingMoves.includes('c1'), true);
    assert.ok(castleWithAttackedRook.getLegalMovesFrom('e1').some((m) => m.isCastling === 'Q'));
  });

  it('enforces en passant rank pin, diagonal pin, and en passant check/checkmate', () => {
    // White horizontal rank pin: Ka5, Pe5, Pd5, Rh5 -> exd6 is illegal
    const whiteRankPin = new ChessEngine('4k3/8/8/K2pP2r/8/8/8/8 w - d6 0 1');
    assert.equal(whiteRankPin.getLegalMovesFrom('e5').some((m) => m.isEnPassant), false);

    // Black horizontal rank pin: Ka4, Pd4, Pe4, Rh4 -> dxe3 is illegal
    const blackRankPin = new ChessEngine('4K3/8/8/8/k2pP2R/8/8/8 b - e3 0 1');
    assert.equal(blackRankPin.getLegalMovesFrom('d4').some((m) => m.isEnPassant), false);

    // Diagonal pin on captured victim square: White King on c2, Black Pawn on f5, Black Bishop on g6
    // Capturing e5xf6 e.p. vacates f5 along the c2-g6 diagonal, exposing White King to Bishop!
    const diagVictimPin = new ChessEngine('4k3/8/6b1/4Pp2/8/8/2K5/8 w - f6 0 1');
    assert.equal(diagVictimPin.getLegalMovesFrom('e5').some((m) => m.isEnPassant), false);

    // En passant discovered checkmate along rank 5:
    // After 1... g5, 2. fxg6# vacates f5 & g5 so Ra5 checks Kh5, Rg1 protects g6, Qf8 covers h6, Qa4 covers g4/h4
    const epMate = new ChessEngine('5Q2/6p1/8/R4P1k/Q7/8/8/K5R1 b - - 0 1');
    assert.ok(epMate.makeMove({ from: 'g7', to: 'g5' }));
    const mateRec = epMate.makeMove({ from: 'f5', to: 'g6' });
    assert.ok(mateRec);
    assert.equal(mateRec.move.isEnPassant, true);
    assert.equal(mateRec.san, 'fxg6#');
    assert.equal(epMate.getStatus(), 'checkmate');
    assert.equal(epMate.getWinner(), 'w');
  });

  it('supports promotion with checkmate, underpromotion checkmate, and requires explicit promotion choice', () => {
    // Pawn move onto back rank without specifying promotion piece is rejected
    const missingPromo = new ChessEngine('7k/4P3/8/8/8/8/8/4K3 w - - 0 1');
    assert.equal(missingPromo.makeMove({ from: 'e7', to: 'e8' }), null);

    // Queen promotion delivering back-rank checkmate: e8=Q#
    const promoMate = new ChessEngine('7k/4P1pp/8/8/8/8/8/K7 w - - 0 1');
    const qMate = promoMate.makeMove({ from: 'e7', to: 'e8', promotion: 'q' });
    assert.ok(qMate);
    assert.equal(qMate.san, 'e8=Q#');
    assert.equal(promoMate.getStatus(), 'checkmate');
    assert.equal(promoMate.getWinner(), 'w');

    // Capture promotion delivering checkmate: exd8=R#
    const capPromoMate = new ChessEngine('3r3k/4P1pp/8/8/8/8/8/K7 w - - 0 1');
    const rMate = capPromoMate.makeMove({ from: 'e7', to: 'd8', promotion: 'r' });
    assert.ok(rMate);
    assert.equal(rMate.san, 'exd8=R#');
    assert.equal(capPromoMate.getStatus(), 'checkmate');

    // Underpromotion to Knight delivering smothered checkmate: f8=N#
    const knightMate = new ChessEngine('6br/5Pnk/7p/8/8/8/8/K7 w - - 0 1');
    const nMate = knightMate.makeMove({ from: 'f7', to: 'f8', promotion: 'n' });
    assert.ok(nMate);
    assert.equal(nMate.san, 'f8=N#');
    assert.equal(knightMate.getStatus(), 'checkmate');
  });

  it('formats SAN file, rank, and full-square disambiguation and rejects malformed FENs', () => {
    // 3 Queens on a1, a5, e1 all able to reach e5 (delivers check to Ke8)
    const threeQueens = new ChessEngine('4k3/8/8/Q7/8/8/8/Q3Q2K w - - 0 1');
    const qa1e5 = threeQueens.makeMove({ from: 'a1', to: 'e5' });
    assert.ok(qa1e5);
    assert.equal(qa1e5.san, 'Qa1e5+');

    // File disambiguation: Rooks on a1 and f1 -> Rae1+
    const rookFile = new ChessEngine('4k3/8/8/8/8/8/8/R4R1K w - - 0 1');
    const rae1 = rookFile.makeMove({ from: 'a1', to: 'e1' });
    assert.ok(rae1);
    assert.equal(rae1.san, 'Rae1+');

    // Rank disambiguation: Rooks on a1 and a8 -> R1a4
    const rookRank = new ChessEngine('R7/7k/8/8/8/8/8/R3K3 w - - 0 1');
    const r1a4 = rookRank.makeMove({ from: 'a1', to: 'a4' });
    assert.ok(r1a4);
    assert.equal(r1a4.san, 'R1a4');

    // Malformed FEN rejection
    assert.throws(() => new ChessEngine('invalid fen'));
    assert.throws(() => new ChessEngine('8/8/8/8/8/8/8 w - - 0 1'));
    assert.throws(() => new ChessEngine('8/8/8/8/8/8/8/9 w - - 0 1'));
    assert.throws(() => new ChessEngine('8/8/8/8/8/8/8/8 x - - 0 1'));
    assert.throws(() => new ChessEngine('8/8/8/8/8/8/8/8 w - z9 0 1'));
  });

  it('AI completes Master search well under 1000ms without mutating caller state and returns legal moves', () => {
    const fens = [
      INITIAL_FEN,
      'r1bq1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 b - - 0 7',
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      '4r1k1/p1pb1ppp/1p1p1n2/3P4/2P1P3/2N2N2/PP3PPP/R2Q1RK1 b - - 0 12',
    ];

    const difficulties: Difficulty[] = ['novice', 'club', 'master'];

    for (const fen of fens) {
      const engine = new ChessEngine(fen);
      const state: ChessState = engine.getState();
      const beforeSnapshot = JSON.stringify(state);
      const legalSet = new Set(
        engine.getLegalMoves().map((m) => `${m.from}-${m.to}-${m.promotion ?? ''}`),
      );

      for (const diff of difficulties) {
        const t0 = performance.now();
        const move = chooseBestMove(state, diff);
        const elapsed = performance.now() - t0;

        assert.ok(move, `Expected move from ${diff} AI for FEN ${fen}`);
        assert.equal(
          legalSet.has(`${move.from}-${move.to}-${move.promotion ?? ''}`),
          true,
          `AI (${diff}) returned illegal move`,
        );
        if (diff === 'master') {
          assert.equal(
            elapsed < 1000,
            true,
            `Master AI exceeded 1000ms budget (${elapsed.toFixed(1)}ms) on ${fen}`,
          );
        }
      }

      assert.equal(JSON.stringify(state), beforeSnapshot, 'chooseBestMove must not mutate state');
    }

    // Terminal states (checkmate & stalemate) return null
    const mated = new ChessEngine('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
    assert.equal(mated.getStatus(), 'checkmate');
    assert.equal(chooseBestMove(mated.getState(), 'master'), null);

    const stalemated = new ChessEngine('7k/5Q2/8/8/8/8/8/6K1 b - - 0 1');
    assert.equal(stalemated.getStatus(), 'stalemate');
    assert.equal(chooseBestMove(stalemated.getState(), 'master'), null);

    // Single legal move (Kh8->h7) returns immediately
    const forced = new ChessEngine('7k/8/5Q2/8/8/8/8/6RK b - - 0 1');
    const forcedMove = chooseBestMove(forced.getState(), 'master');
    assert.ok(forcedMove);
    assert.equal(sqToAlgebraic(forcedMove.from), 'h8');
    assert.equal(sqToAlgebraic(forcedMove.to), 'h7');
  });

  it('predictWinner() accurately reports mate-in-1, terminal states, and large material advantages', () => {
    // White mate-in-1 threat
    const whiteM1 = new ChessEngine('6k1/5ppp/8/8/8/8/4Q3/R5K1 w - - 0 1');
    const wPred = predictWinner(whiteM1.getState());
    assert.equal(wPred.predictedWinner, 'White — Forced Mate');
    assert.equal(wPred.evalLabel, 'M1');
    assert.equal(wPred.whiteWinPct, 99);
    assert.equal(wPred.blackWinPct, 1);

    // Black mate-in-1 threat
    const blackM1 = new ChessEngine('6k1/8/8/8/8/3r4/5PPP/6K1 b - - 0 1');
    const bPred = predictWinner(blackM1.getState());
    assert.equal(bPred.predictedWinner, 'Black — Forced Mate');
    assert.equal(bPred.evalLabel, '-M1');
    assert.equal(bPred.whiteWinPct, 1);
    assert.equal(bPred.blackWinPct, 99);

    // Large White advantage (up Queen + Rook, no immediate M1)
    const whiteBig = new ChessEngine('4k3/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1');
    const whiteBigPred = predictWinner(whiteBig.getState());
    assert.equal(evaluateBoard(whiteBig.getState()) >= 2500, true);
    assert.equal(whiteBigPred.whiteWinPct >= 98, true);
    assert.equal(whiteBigPred.evalLabel.startsWith('+'), true);
    assert.equal(whiteBigPred.predictedWinner.startsWith('White Advantage (+'), true);

    // Large Black advantage (up Queen + Rook, no immediate M1)
    const blackBig = new ChessEngine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/4K3 w kq - 0 1');
    const blackBigPred = predictWinner(blackBig.getState());
    assert.equal(evaluateBoard(blackBig.getState()) <= -2500, true);
    assert.equal(blackBigPred.whiteWinPct <= 2, true);
    assert.equal(blackBigPred.evalLabel.startsWith('-'), true);
    assert.equal(blackBigPred.predictedWinner.startsWith('Black Advantage (-'), true);

    // Terminal checkmate & stalemate
    const checkmatedWhite = new ChessEngine('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    const cmPred = predictWinner(checkmatedWhite.getState());
    assert.equal(cmPred.predictedWinner, 'Checkmate — Black Wins');
    assert.equal(cmPred.evalLabel, '0-1');
    assert.equal(cmPred.whiteWinPct, 0);
    assert.equal(cmPred.blackWinPct, 100);

    const stalemate = new ChessEngine('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    const smPred = predictWinner(stalemate.getState());
    assert.equal(smPred.predictedWinner, 'Draw — Stalemate');
    assert.equal(smPred.evalLabel, '½-½');
    assert.equal(smPred.whiteWinPct, 50);
    assert.equal(smPred.blackWinPct, 50);
  });
});

describe('Chess QA — Headless Chrome E2E (/games/chess.html)', () => {
  let server: http.Server;
  let baseUrl = '';
  let chessUrl = '';

  before(async () => {
    const repoRoot = resolveRepoRoot();
    server = createAppServer(repoRoot);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        baseUrl = `http://127.0.0.1:${addr.port}/`;
        chessUrl = `${baseUrl}games/chess.html`;
        resolve();
      });
    });
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('renders 64 squares, 32 SVG pieces, clean layout/controls, plays e2-e4 + AI reply, Hint, Undo, and cancels stale AI timers on Reset', async () => {
    await withBrowserPage(
      chessUrl,
      async (page) => {
        // Wait for controller initialization to populate all 64 squares
        await page.waitFor("document.querySelectorAll('#chess-board .chess-square').length === 64");

        // 1. Initial Board, SVG Pieces, Back Link, Modal & HUD Check
        const initialSnapshot = await page.evaluate<{
          squareCount: number;
          squareSizesOk: boolean;
          svgCount: number;
          svgSizesOk: boolean;
          hasUnicodeChess: boolean;
          pieceMap: Record<string, string>;
          backHref: string | null;
          promoHidden: boolean;
          promoRectWidth: number;
          whiteMat: string | null;
          blackMat: string | null;
          matDiff: string | null;
          moveCountLabel: string | null;
          undoDisabled: boolean;
          hintDisabled: boolean;
          activeDiff: string | null;
          tierBadge: string | null;
        }>(`(() => {
          const squares = Array.from(document.querySelectorAll('#chess-board .chess-square'));
          const svgs = Array.from(document.querySelectorAll('#chess-board .chess-square svg.piece-svg'));
          const boardText = document.querySelector('#chess-board')?.textContent || '';
          const hasUnicodeChess = /[\\u2654-\\u265F]/.test(boardText);

          let squareSizesOk = squares.length === 64;
          for (const sq of squares) {
            const r = sq.getBoundingClientRect();
            if (r.width < 28 || Math.abs(r.width - r.height) > 2) {
              squareSizesOk = false;
              break;
            }
          }

          let svgSizesOk = svgs.length === 32;
          for (const svg of svgs) {
            const r = svg.getBoundingClientRect();
            if (r.width < 16 || r.height < 16) {
              svgSizesOk = false;
              break;
            }
          }

          const pieceMap = {};
          for (const sq of squares) {
            const coord = sq.getAttribute('data-square');
            const piece = sq.getAttribute('data-piece');
            if (coord && piece) {
              pieceMap[coord] = piece;
            }
          }

          const promoModal = document.querySelector('#promotion-modal');
          const promoRect = promoModal ? promoModal.getBoundingClientRect() : { width: 0 };
          const activeDiffBtn = document.querySelector('#difficulty-selector [aria-pressed="true"]');

          return {
            squareCount: squares.length,
            squareSizesOk,
            svgCount: svgs.length,
            svgSizesOk,
            hasUnicodeChess,
            pieceMap,
            backHref: document.querySelector('.arcade-back-link')?.getAttribute('href') ?? null,
            promoHidden: Boolean(promoModal?.hasAttribute('hidden')),
            promoRectWidth: promoRect.width,
            whiteMat: document.querySelector('#white-material')?.textContent ?? null,
            blackMat: document.querySelector('#black-material')?.textContent ?? null,
            matDiff: document.querySelector('#material-diff')?.textContent ?? null,
            moveCountLabel: document.querySelector('#move-count-label')?.textContent ?? null,
            undoDisabled: Boolean(document.querySelector('#undo-btn')?.hasAttribute('disabled')),
            hintDisabled: Boolean(document.querySelector('#hint-btn')?.hasAttribute('disabled')),
            activeDiff: activeDiffBtn?.getAttribute('data-difficulty') ?? null,
            tierBadge: document.querySelector('#ai-tier-badge')?.textContent ?? null,
          };
        })()`);

        assert.equal(initialSnapshot.squareCount, 64);
        assert.equal(initialSnapshot.squareSizesOk, true);
        assert.equal(initialSnapshot.svgCount, 32);
        assert.equal(initialSnapshot.svgSizesOk, true);
        assert.equal(initialSnapshot.hasUnicodeChess, false);
        assert.deepEqual(initialSnapshot.pieceMap, INITIAL_BOARD_MAP);
        assert.equal(initialSnapshot.backHref, '../index.html');
        assert.equal(initialSnapshot.promoHidden, true);
        assert.equal(initialSnapshot.promoRectWidth, 0);
        assert.equal(initialSnapshot.whiteMat, '39');
        assert.equal(initialSnapshot.blackMat, '39');
        assert.equal(initialSnapshot.matDiff, '0');
        assert.equal(initialSnapshot.moveCountLabel, '0 plies');
        assert.equal(initialSnapshot.undoDisabled, true);
        assert.equal(initialSnapshot.hintDisabled, true);
        assert.equal(initialSnapshot.activeDiff, 'club');
        assert.equal(initialSnapshot.tierBadge, 'CLUB');

        // Verify Back to Arcade target URL resolves cleanly (HTTP 200)
        const backRes = await fetch(new URL(initialSnapshot.backHref ?? '../index.html', chessUrl));
        assert.equal(backRes.status, 200);

        // 2. Start match, select e2, verify legal move dots appear before placing e4
        await page.click('#start-btn');
        await page.waitFor("!document.querySelector('#hint-btn')?.hasAttribute('disabled')");

        await page.click('.chess-square[data-square="e2"]');
        await page.waitFor("document.querySelector('.chess-square[data-square=\"e2\"]')?.classList.contains('is-selected')");

        const legalBeforeE4 = await page.evaluate<{
          e2Selected: boolean;
          e3Dot: boolean;
          e4Dot: boolean;
          totalDots: number;
        }>(`(() => ({
          e2Selected: Boolean(document.querySelector('.chess-square[data-square="e2"]')?.classList.contains('is-selected')),
          e3Dot: Boolean(document.querySelector('.chess-square[data-square="e3"] .legal-dot')),
          e4Dot: Boolean(document.querySelector('.chess-square[data-square="e4"] .legal-dot')),
          totalDots: document.querySelectorAll('#chess-board .legal-dot').length,
        }))()`);
        assert.equal(legalBeforeE4.e2Selected, true);
        assert.equal(legalBeforeE4.e3Dot, true);
        assert.equal(legalBeforeE4.e4Dot, true);
        assert.equal(legalBeforeE4.totalDots, 2);

        // 3. Play e4 and wait for AI Black move to complete in #move-list (2 plies)
        await page.click('.chess-square[data-square="e4"]');
        await page.waitFor(
          "document.querySelector('#move-count-label')?.textContent === '2 plies' && !document.querySelector('#hint-btn')?.hasAttribute('disabled')",
          8000,
        );

        const afterFirstExchange = await page.evaluate<{
          moveCountLabel: string | null;
          plies: string[];
          e2Piece: string | null;
          e4Piece: string | null;
          predictedLabel: string | null;
          evalLabel: string | null;
          whiteWinPct: string | null;
          blackWinPct: string | null;
          evalBarWidth: string;
          whiteMat: string | null;
          blackMat: string | null;
          undoDisabled: boolean;
        }>(`(() => {
          const plies = Array.from(document.querySelectorAll('#move-list .move-ply'))
            .map((el) => (el.textContent || '').trim())
            .filter(Boolean);
          return {
            moveCountLabel: document.querySelector('#move-count-label')?.textContent ?? null,
            plies,
            e2Piece: document.querySelector('.chess-square[data-square="e2"]')?.getAttribute('data-piece') ?? null,
            e4Piece: document.querySelector('.chess-square[data-square="e4"]')?.getAttribute('data-piece') ?? null,
            predictedLabel: document.querySelector('#predicted-winner-label')?.textContent ?? null,
            evalLabel: document.querySelector('#eval-score-label')?.textContent ?? null,
            whiteWinPct: document.querySelector('#white-win-pct')?.textContent ?? null,
            blackWinPct: document.querySelector('#black-win-pct')?.textContent ?? null,
            evalBarWidth: document.querySelector('#eval-bar-fill')?.style.width ?? '',
            whiteMat: document.querySelector('#white-material')?.textContent ?? null,
            blackMat: document.querySelector('#black-material')?.textContent ?? null,
            undoDisabled: Boolean(document.querySelector('#undo-btn')?.hasAttribute('disabled')),
          };
        })()`);

        assert.equal(afterFirstExchange.moveCountLabel, '2 plies');
        assert.equal(afterFirstExchange.plies.length, 2);
        assert.equal(afterFirstExchange.plies[0], 'e4');
        assert.equal(afterFirstExchange.e2Piece, null);
        assert.equal(afterFirstExchange.e4Piece, 'wp');
        assert.ok(afterFirstExchange.predictedLabel && afterFirstExchange.predictedLabel.length > 0);
        assert.match(afterFirstExchange.evalLabel ?? '', /^[+-]\d+\.\d+$/);
        assert.match(afterFirstExchange.whiteWinPct ?? '', /^White \d+%$/);
        assert.match(afterFirstExchange.blackWinPct ?? '', /^Black \d+%$/);
        assert.match(afterFirstExchange.evalBarWidth, /^\d+%$/);
        assert.equal(afterFirstExchange.whiteMat, '39');
        assert.equal(afterFirstExchange.blackMat, '39');
        assert.equal(afterFirstExchange.undoDisabled, false);

        // 4. Test Difficulty Selector (master / novice / club)
        await page.click('#difficulty-selector [data-difficulty="master"]');
        await page.waitFor("document.querySelector('#ai-tier-badge')?.textContent === 'MASTER'");
        await page.click('#difficulty-selector [data-difficulty="novice"]');
        await page.waitFor("document.querySelector('#ai-tier-badge')?.textContent === 'NOVICE'");

        // 5. Test Hint (#hint-btn)
        await page.click('#hint-btn');
        await page.waitFor("document.querySelectorAll('#chess-board .is-hint-from').length === 1 && document.querySelectorAll('#chess-board .is-hint-to').length === 1");
        const hintStatus = await page.evaluate<string | null>(
          "document.querySelector('#status-text')?.textContent ?? null",
        );
        assert.ok(hintStatus && hintStatus.startsWith('HINT:'), `Expected HINT status, got ${hintStatus}`);

        // 6. Test Undo (#undo-btn) — undoes the move pair back to initial position
        await page.click('#undo-btn');
        await page.waitFor("document.querySelector('#move-count-label')?.textContent === '0 plies'");
        const afterUndo = await page.evaluate<{
          pieceMap: Record<string, string>;
          undoDisabled: boolean;
          hintCount: number;
          hasEmptyMsg: boolean;
        }>(`(() => {
          const pieceMap = {};
          for (const sq of document.querySelectorAll('#chess-board .chess-square')) {
            const coord = sq.getAttribute('data-square');
            const piece = sq.getAttribute('data-piece');
            if (coord && piece) pieceMap[coord] = piece;
          }
          return {
            pieceMap,
            undoDisabled: Boolean(document.querySelector('#undo-btn')?.hasAttribute('disabled')),
            hintCount: document.querySelectorAll('#chess-board .is-hint-from, #chess-board .is-hint-to').length,
            hasEmptyMsg: Boolean(document.querySelector('#move-list .move-list-empty')),
          };
        })()`);
        assert.deepEqual(afterUndo.pieceMap, INITIAL_BOARD_MAP);
        assert.equal(afterUndo.undoDisabled, true);
        assert.equal(afterUndo.hintCount, 0);
        assert.equal(afterUndo.hasEmptyMsg, true);

        // 7. Test Reset after playing & stale AI timer cancellation mid-flight
        await page.click('.chess-square[data-square="d2"]');
        await page.click('.chess-square[data-square="d4"]');
        await page.waitFor(
          "document.querySelector('#move-count-label')?.textContent === '2 plies'",
          8000,
        );

        await page.click('#reset-btn');
        await page.waitFor("document.querySelector('#move-count-label')?.textContent === '0 plies'");

        // Now start via keyboard 's', move e2->e4, and immediately click Reset while AI timer (140ms) is pending
        await page.pressKey('s');
        await page.waitFor("!document.querySelector('#hint-btn')?.hasAttribute('disabled')");
        await page.click('.chess-square[data-square="e2"]');
        await page.click('.chess-square[data-square="e4"]');
        await page.click('#reset-btn');

        // Wait past the AI timeout (450ms) and assert zero stale AI moves landed
        await new Promise((r) => setTimeout(r, 450));

        const afterImmediateReset = await page.evaluate<{
          pieceMap: Record<string, string>;
          svgCount: number;
          moveCountLabel: string | null;
          hasEmptyMsg: boolean;
          statusText: string | null;
          turnBadge: string | null;
          undoDisabled: boolean;
          hintDisabled: boolean;
        }>(`(() => {
          const pieceMap = {};
          for (const sq of document.querySelectorAll('#chess-board .chess-square')) {
            const coord = sq.getAttribute('data-square');
            const piece = sq.getAttribute('data-piece');
            if (coord && piece) pieceMap[coord] = piece;
          }
          return {
            pieceMap,
            svgCount: document.querySelectorAll('#chess-board .chess-square svg.piece-svg').length,
            moveCountLabel: document.querySelector('#move-count-label')?.textContent ?? null,
            hasEmptyMsg: Boolean(document.querySelector('#move-list .move-list-empty')),
            statusText: document.querySelector('#status-text')?.textContent ?? null,
            turnBadge: document.querySelector('#turn-badge')?.textContent ?? null,
            undoDisabled: Boolean(document.querySelector('#undo-btn')?.hasAttribute('disabled')),
            hintDisabled: Boolean(document.querySelector('#hint-btn')?.hasAttribute('disabled')),
          };
        })()`);

        assert.equal(afterImmediateReset.svgCount, 32);
        assert.deepEqual(afterImmediateReset.pieceMap, INITIAL_BOARD_MAP);
        assert.equal(afterImmediateReset.moveCountLabel, '0 plies');
        assert.equal(afterImmediateReset.hasEmptyMsg, true);
        assert.equal(afterImmediateReset.statusText, 'READY — PRESS START TO ENGAGE');
        assert.equal(afterImmediateReset.turnBadge, 'WHITE READY');
        assert.equal(afterImmediateReset.undoDisabled, true);
        assert.equal(afterImmediateReset.hintDisabled, true);

        // 8. Verify scoreboard, captured trays, eval bar ARIA, and full keyboard play (S, Arrows, Enter, H, U, R)
        const hudMeta = await page.evaluate<{
          wins: string | null;
          draws: string | null;
          losses: string | null;
          evalAriaNow: string | null;
          detail: string | null;
          hasCapturedTrays: boolean;
        }>(`(() => ({
          wins: document.querySelector('#session-wins')?.textContent ?? null,
          draws: document.querySelector('#session-draws')?.textContent ?? null,
          losses: document.querySelector('#session-losses')?.textContent ?? null,
          evalAriaNow: document.querySelector('.eval-meter-bar')?.getAttribute('aria-valuenow') ?? null,
          detail: document.querySelector('#predicted-detail')?.textContent ?? null,
          hasCapturedTrays: Boolean(
            document.querySelector('#white-captured') && document.querySelector('#black-captured'),
          ),
        }))()`);
        assert.equal(hudMeta.wins, '0');
        assert.equal(hudMeta.draws, '0');
        assert.equal(hudMeta.losses, '0');
        assert.equal(hudMeta.evalAriaNow, '50');
        assert.equal(hudMeta.detail, 'Material balanced');
        assert.equal(hudMeta.hasCapturedTrays, true);

        await page.pressKey('s');
        await page.waitFor("!document.querySelector('#hint-btn')?.hasAttribute('disabled')");
        await page.pressKey('ArrowLeft'); // cursor e2 -> d2
        await page.pressKey('Enter'); // select d2
        await page.waitFor("document.querySelector('.chess-square[data-square=\"d2\"]')?.classList.contains('is-selected')");
        await page.pressKey('ArrowUp'); // d3
        await page.pressKey('ArrowUp'); // d4
        await page.pressKey('Enter'); // play d4
        await page.waitFor(
          "document.querySelector('#move-count-label')?.textContent === '2 plies' && !document.querySelector('#hint-btn')?.hasAttribute('disabled')",
          8000,
        );
        await page.pressKey('h');
        await page.waitFor("document.querySelectorAll('#chess-board .is-hint-from').length === 1");
        await page.pressKey('u');
        await page.waitFor("document.querySelector('#move-count-label')?.textContent === '0 plies'");
        await page.pressKey('r');
        await page.waitFor("document.querySelector('#turn-badge')?.textContent === 'WHITE READY'");

        assert.deepEqual(page.pageErrors, []);
        assert.deepEqual(page.consoleErrors, []);
        assert.deepEqual(page.failedRequests, []);
      },
      { width: 1440, height: 900 },
    );
  });
});
