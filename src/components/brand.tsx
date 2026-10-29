import Image from "next/image";
import logo from "../../public/brand/bkl-logo.png";

/**
 * The BKL Development Limited logo, taken from the approved prototype document
 * (first image, word/media/image1.png). Shown on its own slate background, never
 * recoloured or stretched.
 */
export function BrandLogo({ width = 150, priority = false, className = "", decorative = false }: { width?: number; priority?: boolean; className?: string; /** Beside the company name already written out (e.g. the footer): hidden from screen readers so it is not read twice. */ decorative?: boolean }) {
  return (
    <Image
      src={logo}
      alt={decorative ? "" : "BKL Development Limited"}
      width={width}
      height={Math.round((width * logo.height) / logo.width)}
      priority={priority}
      className={`rounded-lg ${className}`}
    />
  );
}
