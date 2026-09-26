declare module "clipper-lib" {
  type Point = { X: number; Y: number };
  const ClipperLib: {
    Clipper: { new(): { AddPaths(paths: Point[][], type: number, closed: boolean): void; Execute(type: number, result: Point[][], fill: number, clipFill: number): boolean } };
    ClipperOffset: { new(miterLimit: number, arcTolerance: number): { AddPaths(paths: Point[][], join: number, end: number): void; Execute(result: Point[][], distance: number): void } };
    PolyType: { ptSubject: number }; ClipType: { ctUnion: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number };
    JoinType: { jtRound: number; jtMiter: number; jtSquare: number };
    EndType: { etClosedPolygon: number };
  };
  export default ClipperLib;
}
