/** The slice of fast-formula-parser the export test uses; the package ships no types. */
declare module 'fast-formula-parser' {
  interface CellRef {
    readonly sheet: string;
    readonly row: number;
    readonly col: number;
  }
  interface RangeRef {
    readonly sheet: string;
    readonly from: { readonly row: number; readonly col: number };
    readonly to: { readonly row: number; readonly col: number };
  }
  export default class FormulaParser {
    constructor(config: {
      onCell?: (ref: CellRef) => unknown;
      onRange?: (ref: RangeRef) => unknown[][];
    });
    parse(formula: string, position: CellRef): unknown;
  }
}
