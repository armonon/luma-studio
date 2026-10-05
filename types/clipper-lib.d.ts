declare module "clipper-lib" {
  type Point = { X: number; Y: number };
  const ClipperLib: {
    Clipper: {
      new(): { AddPaths(paths: Point[][], type: number, closed: boolean): void; Execute(type: number, result: Point[][], fill: number, clipFill: number): boolean };
      Orientation(path: Point[]): boolean;
      Area(path: Point[]): number;
      CleanPolygons(paths: Point[][], distance: number): Point[][];
    };
    ClipperOffset: { new(miterLimit: number, arcTolerance: number): { AddPaths(paths: Point[][], join: number, end: number): void; Execute(result: Point[][], distance: number): void } };
    PolyType: { ptSubject: number; ptClip: number }; ClipType: { ctUnion: number; ctDifference: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number };
    JoinType: { jtRound: number; jtMiter: number; jtSquare: number };
    EndType: { etClosedPolygon: number; etOpenRound: number };
  };
  export default ClipperLib;
}
