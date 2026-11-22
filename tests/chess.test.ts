import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  algebraicToSq,
  ChessEngine,
  INITIAL_FEN,
  sqToAlgebraic,
} from '../ts/games/chess/engine.js';
import {
  chooseBestMove,
  evaluateBoard,
  predictWinner,
} from '../ts/games/chess/ai.js';
import type { Difficulty } from '../ts/games/chess/types.js';

describe('Chess Engine & AI ("Grandmaster Protocol")', () => {
  it('generates exactly 20 legal moves from the initial starting position', () => {
    const engine = new ChessEngine();
    const moves = engine.getLegalMoves();
    assert.equal(moves.length, 20);
    assert.equal(engine.getTurn(), 'w');
    assert.equal(engine.isInCheck(), false);
    assert.deepEqual(engine.getMaterialSummary(), { white: 39, black: 39, diff: 0 });
  });

  it('enforces absolute pins and prevents moving into or leaving king in check', () => {
    // White knight on e4 is absolutely pinned by Black rook on e8 against White king on e1
    const orthoPinned = new ChessEngine('4r2k/8/8/8/4N3/8/8/4K3 w - - 0 1');
    assert.equal(orthoPinned.getLegalMovesFrom('e4').length, 0);

    // White bishop on d2 is diagonally pinned by Black queen on a5 against White king on e1
    const diagPinned = new ChessEngine('4k3/8/8/q7/8/8/3B4/4K3 w - - 0 1');
    const bishopTargets = diagPinned
      .getLegalMovesFrom('d2')
      .map((m) => sqToAlgebraic(m.to))
      .sort();
    assert.deepEqual(bishopTargets, ['a5', 'b4', 'c3']);

    // King cannot move onto attacked squares (d-file attacked by Black rook on d8)
    const rookWall = new ChessEngine('3rk3/8/8/8/8/8/8/4K3 w - - 0 1');
    const kingMoves = rookWall
      .getLegalMovesFrom('e1')
      .map((m) => sqToAlgebraic(m.to))
      .sort();
    assert.deepEqual(kingMoves, ['e2', 'f1', 'f2']);
  });

  it('allows legal kingside and queenside castling and relocates king and rook properly', () => {
    const whiteCastle = new ChessEngine('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const kingMoves = whiteCastle.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(kingMoves.includes('g1'), true);
    assert.equal(kingMoves.includes('c1'), true);

    const rec = whiteCastle.makeMove({ from: 'e1', to: 'g1' });
    assert.ok(rec);
    assert.equal(rec.san, 'O-O');
    assert.equal(whiteCastle.getPieceAt('g1')?.type, 'k');
    assert.equal(whiteCastle.getPieceAt('f1')?.type, 'r');
    assert.equal(whiteCastle.getPieceAt('e1'), null);
    assert.equal(whiteCastle.getPieceAt('h1'), null);
    assert.equal(whiteCastle.getState().castling.wK, false);
    assert.equal(whiteCastle.getState().castling.wQ, false);

    // Black queenside castling
    const recBlack = whiteCastle.makeMove({ from: 'e8', to: 'c8' });
    assert.ok(recBlack);
    assert.equal(recBlack.san, 'O-O-O');
    assert.equal(whiteCastle.getPieceAt('c8')?.type, 'k');
    assert.equal(whiteCastle.getPieceAt('d8')?.type, 'r');
    assert.equal(whiteCastle.getPieceAt('a8'), null);
  });

  it('rejects all illegal castling cases (moved king/rook, captured rook, blocked, check, through check)', () => {
    // 1. Moved king then returned loses both castling rights
    const movedKing = new ChessEngine('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    movedKing.makeMove({ from: 'e1', to: 'e2' });
    movedKing.makeMove({ from: 'a8', to: 'a7' });
    movedKing.makeMove({ from: 'e2', to: 'e1' });
    movedKing.makeMove({ from: 'a7', to: 'a8' });
    const afterKingMove = movedKing.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(afterKingMove.includes('g1'), false);
    assert.equal(afterKingMove.includes('c1'), false);

    // 2. Moved h1 rook loses kingside only, keeps queenside
    const movedRook = new ChessEngine('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    movedRook.makeMove({ from: 'h1', to: 'h2' });
    movedRook.makeMove({ from: 'e8', to: 'd8' });
    movedRook.makeMove({ from: 'h2', to: 'h1' });
    movedRook.makeMove({ from: 'd8', to: 'e8' });
    const afterRookMove = movedRook.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(afterRookMove.includes('g1'), false);
    assert.equal(afterRookMove.includes('c1'), true);

    // 3. Capturing corner rook revokes opponent castling right
    const capCorner = new ChessEngine('r3k2r/8/8/8/8/8/1B6/4K3 w kq - 0 1');
    capCorner.makeMove({ from: 'b2', to: 'h8' });
    assert.equal(capCorner.getState().castling.bK, false);
    assert.equal(capCorner.getState().castling.bQ, true);

    // 4. Blocked path (b1 occupied blocks O-O-O; f1 occupied blocks O-O)
    const blocked = new ChessEngine('4k3/8/8/8/8/8/8/RN2KB1R w KQ - 0 1');
    const blockedMoves = blocked.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(blockedMoves.includes('g1'), false);
    assert.equal(blockedMoves.includes('c1'), false);

    // 5. King currently in check cannot castle
    const inCheck = new ChessEngine('4k3/4r3/8/8/8/8/8/R3K2R w KQ - 0 1');
    const inCheckMoves = inCheck.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(inCheckMoves.includes('g1'), false);
    assert.equal(inCheckMoves.includes('c1'), false);

    // 6. King passing through attacked square (f1 or d1) cannot castle
    const throughCheck = new ChessEngine('3rk3/5r2/8/8/8/8/8/R3K2R w KQ - 0 1');
    const throughMoves = throughCheck.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(throughMoves.includes('g1'), false);
    assert.equal(throughMoves.includes('c1'), false);

    // 7. King landing on attacked square (g1 or c1) cannot castle
    const intoCheck = new ChessEngine('2r1k3/6r1/8/8/8/8/8/R3K2R w KQ - 0 1');
    const intoMoves = intoCheck.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(intoMoves.includes('g1'), false);
    assert.equal(intoMoves.includes('c1'), false);

    // 8. b1 attacked still allows O-O-O when b1 is empty and e1/d1/c1 are safe
    const b1Attacked = new ChessEngine('1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
    const b1Moves = b1Attacked.getLegalMovesFrom('e1').map((m) => sqToAlgebraic(m.to));
    assert.equal(b1Moves.includes('c1'), true);
  });

  it('supports en passant capture, one-turn expiry, and blocks horizontal rank pin en passant', () => {
    const engine = new ChessEngine();
    assert.ok(engine.makeMove({ from: 'e2', to: 'e4' }));
    assert.ok(engine.makeMove({ from: 'a7', to: 'a6' }));
    assert.ok(engine.makeMove({ from: 'e4', to: 'e5' }));
    assert.ok(engine.makeMove({ from: 'd7', to: 'd5' }));

    assert.equal(engine.getState().enPassantSq, algebraicToSq('d6'));
    const epTargets = engine.getLegalMovesFrom('e5').map((m) => sqToAlgebraic(m.to));
    assert.equal(epTargets.includes('d6'), true);

    const epRec = engine.makeMove({ from: 'e5', to: 'd6' });
    assert.ok(epRec);
    assert.equal(epRec.move.isEnPassant, true);
    assert.equal(epRec.san, 'exd6');
    assert.equal(engine.getPieceAt('d6')?.color, 'w');
    assert.equal(engine.getPieceAt('d5'), null);
    assert.deepEqual(engine.getState().capturedByWhite, ['p']);

    // En passant expires if not played immediately
    const expiry = new ChessEngine();
    expiry.makeMove({ from: 'e2', to: 'e4' });
    expiry.makeMove({ from: 'a7', to: 'a6' });
    expiry.makeMove({ from: 'e4', to: 'e5' });
    expiry.makeMove({ from: 'd7', to: 'd5' });
    expiry.makeMove({ from: 'a2', to: 'a3' });
    expiry.makeMove({ from: 'a6', to: 'a5' });
    assert.equal(expiry.getState().enPassantSq, null);
    assert.equal(
      expiry.getLegalMovesFrom('e5').some((m) => m.isEnPassant),
      false,
    );

    // Horizontal rank pin edge case: Ka5, Pe5 (White) and Pd5, Rh5 (Black)
    // Capturing exd6 would vacate both d5 & e5 and expose Ka5 horizontally to Rh5!
    const horizPin = new ChessEngine('4k3/8/8/K2pP2r/8/8/8/8 w - d6 0 1');
    const legalFromE5 = horizPin.getLegalMovesFrom('e5');
    assert.equal(
      legalFromE5.some((m) => m.isEnPassant),
      false,
    );
  });

  it('supports pawn promotion to all 4 piece types (q, r, b, n)', () => {
    const engine = new ChessEngine('k2r4/4P3/8/8/8/8/8/4K3 w - - 0 1');
    const promoMoves = engine
      .getLegalMovesFrom('e7')
      .filter((m) => m.to === algebraicToSq('e8'));
    assert.deepEqual(
      promoMoves.map((m) => m.promotion).sort(),
      ['b', 'n', 'q', 'r'],
    );

    // Promote via capture on d8 to Knight with check
    const rec = engine.makeMove({ from: 'e7', to: 'd8', promotion: 'n' });
    assert.ok(rec);
    assert.equal(rec.san, 'exd8=N');
    assert.equal(engine.getPieceAt('d8')?.type, 'n');
    assert.equal(engine.getPieceAt('d8')?.color, 'w');
    assert.equal(engine.getMaterialSummary().white, 3);

    // Queen promotion delivering checkmate / check
    const qEngine = new ChessEngine('k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
    const qRec = qEngine.makeMove({ from: 'e7', to: 'e8', promotion: 'q' });
    assert.ok(qRec);
    assert.equal(qRec.san, 'e8=Q+');
    assert.equal(qEngine.getPieceAt('e8')?.type, 'q');
    assert.equal(qEngine.getMaterialSummary().white, 9);
  });

  it("detects checkmate accurately in Fool's Mate and Scholar's Mate", () => {
    // Fool's Mate (Black wins in 2 moves)
    const fools = new ChessEngine();
    fools.makeMove({ from: 'f2', to: 'f3' });
    fools.makeMove({ from: 'e7', to: 'e5' });
    fools.makeMove({ from: 'g2', to: 'g4' });
    const mateBlack = fools.makeMove({ from: 'd8', to: 'h4' });
    assert.ok(mateBlack);
    assert.equal(mateBlack.san, 'Qh4#');
    assert.equal(fools.getStatus(), 'checkmate');
    assert.equal(fools.getWinner(), 'b');
    assert.equal(fools.isInCheck(), true);
    assert.equal(fools.getLegalMoves().length, 0);

    // Scholar's Mate (White wins in 4 moves)
    const scholars = new ChessEngine();
    scholars.makeMove({ from: 'e2', to: 'e4' });
    scholars.makeMove({ from: 'e7', to: 'e5' });
    scholars.makeMove({ from: 'f1', to: 'c4' });
    scholars.makeMove({ from: 'b8', to: 'c6' });
    scholars.makeMove({ from: 'd1', to: 'h5' });
    scholars.makeMove({ from: 'g8', to: 'f6' });
    const mateWhite = scholars.makeMove({ from: 'h5', to: 'f7' });
    assert.ok(mateWhite);
    assert.equal(mateWhite.san, 'Qxf7#');
    assert.equal(scholars.getStatus(), 'checkmate');
    assert.equal(scholars.getWinner(), 'w');
    assert.equal(scholars.isInCheck(), true);
    assert.equal(scholars.getLegalMoves().length, 0);
  });

  it('detects stalemate accurately', () => {
    const stalemate = new ChessEngine('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.equal(stalemate.getStatus(), 'stalemate');
    assert.equal(stalemate.getWinner(), 'draw');
    assert.equal(stalemate.isInCheck(), false);
    assert.equal(stalemate.getLegalMoves().length, 0);
  });

  it('detects insufficient material (K vs K, K+N vs K, K+B vs K, same-color K+B vs K+B)', () => {
    assert.equal(new ChessEngine('4k3/8/8/8/8/8/8/4K3 w - - 0 1').getStatus(), 'draw-insufficient');
    assert.equal(new ChessEngine('4k3/8/8/8/8/8/3N4/4K3 w - - 0 1').getStatus(), 'draw-insufficient');
    assert.equal(new ChessEngine('4k3/8/8/8/8/8/3B4/4K3 w - - 0 1').getStatus(), 'draw-insufficient');
    // Same square color bishops: c1 (dark) & f8 (dark)
    assert.equal(new ChessEngine('5b1k/8/8/8/8/8/8/2B1K3 w - - 0 1').getStatus(), 'draw-insufficient');
    // Opposite square color bishops: c1 (dark) & c8 (light) -> sufficient
    assert.equal(new ChessEngine('2b4k/8/8/8/8/8/8/2B1K3 w - - 0 1').getStatus(), 'active');
    // Rook + King vs King -> sufficient
    assert.equal(new ChessEngine('4k3/8/8/8/8/8/3R4/4K3 w - - 0 1').getStatus(), 'active');
  });

  it('detects threefold repetition and 50-move rule draws', () => {
    const rep = new ChessEngine();
    for (let cycle = 0; cycle < 2; cycle += 1) {
      assert.ok(rep.makeMove({ from: 'g1', to: 'f3' }));
      assert.ok(rep.makeMove({ from: 'g8', to: 'f6' }));
      assert.ok(rep.makeMove({ from: 'f3', to: 'g1' }));
      assert.ok(rep.makeMove({ from: 'f6', to: 'g8' }));
    }
    assert.equal(rep.getStatus(), 'draw-repetition');
    assert.equal(rep.getWinner(), 'draw');

    const fifty = new ChessEngine('4k3/8/8/8/8/8/R7/4K3 w - - 99 60');
    assert.equal(fifty.getStatus(), 'active');
    assert.ok(fifty.makeMove({ from: 'a2', to: 'a3' }));
    assert.equal(fifty.getState().halfmoveClock, 100);
    assert.equal(fifty.getStatus(), 'draw-fifty-move');
    assert.equal(fifty.getWinner(), 'draw');

    // Checkmate on halfmove 100 still counts as checkmate over 50-move draw
    const mateOn100 = new ChessEngine('4k3/8/4K3/8/8/8/R7/8 w - - 99 60');
    assert.ok(mateOn100.makeMove({ from: 'a2', to: 'a8' }));
    assert.equal(mateOn100.getStatus(), 'checkmate');
    assert.equal(mateOn100.getWinner(), 'w');
  });

  it('AI returns legal moves, finds mate-in-1, captures hanging queen, and runs Master under 300ms', () => {
    const difficulties: Difficulty[] = ['novice', 'club', 'master'];

    // Legal move from initial position
    const start = new ChessEngine();
    const startState = start.getState();
    const legalKeys = new Set(start.getLegalMoves().map((m) => `${m.from}-${m.to}`));
    for (const diff of difficulties) {
      const move = chooseBestMove(startState, diff);
      assert.ok(move, `AI (${diff}) should return a move`);
      assert.equal(legalKeys.has(`${move.from}-${move.to}`), true);
    }

    // Mate-in-1 for Black: Rd3->d1#
    const matePos = new ChessEngine('6k1/8/8/8/8/3r4/5PPP/6K1 b - - 0 1');
    for (const diff of difficulties) {
      const best = chooseBestMove(matePos.getState(), diff);
      assert.ok(best);
      assert.equal(sqToAlgebraic(best.from), 'd3');
      assert.equal(sqToAlgebraic(best.to), 'd1');
    }

    // Capturing hanging White queen on d4 by Black rook on d8
    const hangingQueen = new ChessEngine('3rk3/8/8/8/3Q4/8/8/4K3 b - - 0 1');
    for (const diff of difficulties) {
      const best = chooseBestMove(hangingQueen.getState(), diff);
      assert.ok(best);
      assert.equal(sqToAlgebraic(best.from), 'd8');
      assert.equal(sqToAlgebraic(best.to), 'd4');
    }

    // Master timing benchmark in an open middlegame (< 300ms)
    const middlegame = new ChessEngine(
      'r1bq1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 b - - 0 7',
    );
    const t0 = performance.now();
    const masterMove = chooseBestMove(middlegame.getState(), 'master');
    const elapsedMs = performance.now() - t0;
    assert.ok(masterMove);
    assert.equal(elapsedMs < 300, true, `Expected Master search < 300ms, took ${elapsedMs.toFixed(1)}ms`);
  });

  it('evaluates board and shifts predicted winner meaningfully after material capture', () => {
    const initial = new ChessEngine();
    assert.equal(evaluateBoard(initial.getState()), 0);
    const initPred = predictWinner(initial.getState());
    assert.equal(initPred.whiteWinPct, 50);
    assert.equal(initPred.predictedWinner, 'Even / Draw Likely');
    assert.equal(initPred.evalLabel, '+0.0');

    // White is up a full Queen
    const whiteUpQueen = new ChessEngine('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const cpWhiteUp = evaluateBoard(whiteUpQueen.getState());
    const predWhiteUp = predictWinner(whiteUpQueen.getState());
    assert.equal(cpWhiteUp >= 800, true);
    assert.equal(predWhiteUp.whiteWinPct >= 90, true);
    assert.equal(predWhiteUp.predictedWinner.startsWith('White Advantage (+'), true);

    // Black is up a full Queen
    const blackUpQueen = new ChessEngine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1');
    const cpBlackUp = evaluateBoard(blackUpQueen.getState());
    const predBlackUp = predictWinner(blackUpQueen.getState());
    assert.equal(cpBlackUp <= -800, true);
    assert.equal(predBlackUp.whiteWinPct <= 10, true);
    assert.equal(predBlackUp.predictedWinner.startsWith('Black Advantage (-'), true);

    // Forced mate prediction
    const mateThreat = new ChessEngine('6k1/8/8/8/8/3r4/5PPP/6K1 b - - 0 1');
    const matePred = predictWinner(mateThreat.getState());
    assert.equal(matePred.predictedWinner, 'Black — Forced Mate');
  });

  it('restores full board, clocks, castling, captures, and status on undo and reset', () => {
    const engine = new ChessEngine();
    const fen0 = engine.toFen();

    engine.makeMove({ from: 'e2', to: 'e4' });
    const fen1 = engine.toFen();
    engine.makeMove({ from: 'd7', to: 'd5' });
    const fen2 = engine.toFen();
    engine.makeMove({ from: 'e4', to: 'd5' });
    assert.deepEqual(engine.getState().capturedByWhite, ['p']);
    assert.equal(engine.getMaterialSummary().diff, 1);

    // Undo capture
    engine.undo();
    assert.equal(engine.toFen(), fen2);
    assert.deepEqual(engine.getState().capturedByWhite, []);
    assert.equal(engine.getMaterialSummary().diff, 0);
    assert.equal(engine.getState().enPassantSq, algebraicToSq('d6'));

    // Undo d7-d5
    engine.undo();
    assert.equal(engine.toFen(), fen1);
    assert.equal(engine.getState().enPassantSq, algebraicToSq('e3'));

    // Undo e2-e4
    engine.undo();
    assert.equal(engine.toFen(), fen0);
    assert.equal(engine.getHistory().length, 0);

    // Play Fool's Mate, then verify undo exits checkmate and reset restores INITIAL_FEN
    engine.makeMove({ from: 'f2', to: 'f3' });
    engine.makeMove({ from: 'e7', to: 'e5' });
    engine.makeMove({ from: 'g2', to: 'g4' });
    engine.makeMove({ from: 'd8', to: 'h4' });
    assert.equal(engine.getStatus(), 'checkmate');

    engine.undo();
    assert.equal(engine.getStatus(), 'active');
    assert.equal(engine.getWinner(), null);
    assert.equal(engine.getTurn(), 'b');

    engine.reset();
    assert.equal(engine.toFen(), INITIAL_FEN);
    assert.equal(engine.getStatus(), 'active');
    assert.equal(engine.getHistory().length, 0);
    assert.deepEqual(engine.getMaterialSummary(), { white: 39, black: 39, diff: 0 });
  });
});
