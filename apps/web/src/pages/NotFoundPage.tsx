import { Link } from '../elements/Link';

import type { JSX } from 'react';

export default function NotFoundPage({ back }: Readonly<{ back: string }>): JSX.Element {
  return (
    <>
      <h1>Page not found</h1>
      <Link href={back}>Browse benchmarks</Link>
    </>
  );
}
