import Cutout from "../studio/cutout-workspace";
export const metadata = {
  title: "Cutout: Background Removal & Transparent Images | thecreatingco",
  description: "Local subject matting, mask refinement and transparent PNG export.",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://thecreatingco.com/products/cutout/" },
};
export default function Page() { return <Cutout />; }
