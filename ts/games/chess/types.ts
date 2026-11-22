/**
 * Pure TypeScript domain types for Nexus Arcade Chess ("Grandmaster Protocol").
 * Zero DOM dependencies.
 */

export type Color = 'w' | 'b';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export type PromotionPieceType = 'q' | 'r' | 'b' | 'n';

export type Difficulty = 'novice' | 'club' | 'master';

export type GameStatus =
  | 'active'
  | 'checkmate'
  | 'stalemate'
  | 'draw-insufficient'
  | 'draw-repetition'
  | 'draw-fifty-move';

export interface Piece {
  color: Color;
  type: PieceType;
}

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface Move {
  from: number;
  to: number;
  piece: PieceType;
  color: Color;
  captured?: PieceType;
  promotion?: PromotionPieceType;
  isEnPassant?: boolean;
  isCastling?: 'K' | 'Q';
}

export interface RecordedMove {
  move: Move;
  san: string;
  moveNumber: number;
  color: Color;
  fen: string;
}

export interface ChessState {
  board: (Piece | null)[];
  turn: Color;
  castling: CastlingRights;
  enPassantSq: number | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  history: RecordedMove[];
  capturedByWhite: PieceType[];
  capturedByBlack: PieceType[];
  positionCounts: Record<string, number>;
  status: GameStatus;
  winner: Color | 'draw' | null;
  inCheck: boolean;
}

export interface EvalPrediction {
  centipawns: number;
  pawnScore: number;
  whiteWinPct: number;
  blackWinPct: number;
  predictedWinner: string;
  evalLabel: string;
  detail: string;
}

export interface MaterialSummary {
  white: number;
  black: number;
  diff: number;
}
