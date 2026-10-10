import type { DetailedHTMLProps, HTMLAttributes } from "react";

// <tcc-suite-menu> is rendered by https://thecreatingco.com/suite/v1/suite.js.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "tcc-suite-menu": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
