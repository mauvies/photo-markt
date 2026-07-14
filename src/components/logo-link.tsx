import Image from 'next/image';
import Link from 'next/link';

/**
 * The Photo Markt logo wrapped in a link. Single source of truth for the logo
 * markup so the nav, dashboard headers, sidebar, and footer stay consistent.
 *
 * `href` must already be locale-prefixed by the caller (destinations differ:
 * `/` for public surfaces, the role's dashboard home for dashboard chrome).
 * `className` styles the wrapping link; `imgClassName` sizes the image.
 */
export function LogoLink({
  href,
  className = 'flex items-center gap-2',
  imgClassName = 'h-10 w-auto',
  priority = false,
}: {
  href: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  return (
    <Link href={href} className={className}>
      <Image
        src="/logo.svg"
        alt="Photo Markt"
        className={imgClassName}
        width={90}
        height={90}
        priority={priority}
      />
    </Link>
  );
}
