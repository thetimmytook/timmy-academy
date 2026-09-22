import { Link } from '../elements/Link';

export default function NotFoundPage({ back }: Readonly<{ back: string }>) {
  return (
    <>
      <h1>Page not found</h1>
      <Link href={back}>Browse benchmarks</Link>
    </>
  );
}
