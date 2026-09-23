import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useMatch } from 'react-router';

import { css } from '../styled-system/css';

import { SessionControls } from './auth/SessionControls';
import { lastBrowse } from './bench/navigation';
import { Button } from './elements/Button';
import BenchPage from './pages/BenchPage';
import NotFoundPage from './pages/NotFoundPage';
import RunPage from './pages/RunPage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';

import type { JSX, ReactNode } from 'react';

function PageTitle({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>): JSX.Element {
  useEffect(() => {
    document.title = title + ' · Timmy Academy';
  }, [title]);

  return <>{children}</>;
}

export default function App(): JSX.Element {
  const { pathname, search } = useLocation();
  const browse = useMatch('/bench');
  const detail = useMatch('/bench/runs/:id');
  const id = detail?.params.id;
  const validRun = id !== undefined && /^br_[A-Za-z0-9_-]+$/.test(id);
  const back = browse ? '/bench/' + search : lastBrowse();

  useEffect(() => {
    document.getElementById('main')?.focus();
  }, [pathname]);

  return (
    <>
      <a
        href="#main"
        className={css({
          position: 'absolute',
          left: '4',
          top: '-20',
          _focus: { top: '4', zIndex: 2, bg: 'bg.elevated', p: '4' },
        })}
      >
        Skip to content
      </a>
      <header
        className={css({
          borderBottom: '1px solid',
          borderColor: 'border.default',
          bg: 'bg.surface',
        })}
      >
        <div
          className={css({
            maxWidth: '80rem',
            mx: 'auto',
            px: { base: '4', tablet: '8' },
            py: '4',
            display: 'flex',
            gap: '4',
            alignItems: 'center',
            flexWrap: 'wrap',
          })}
        >
          <span className={css({ textStyle: 'eyebrow' })}>Timmy Academy</span>
          <nav aria-label="Main">
            <Button
              variant="ghost"
              className={css({ color: 'brand.default', bg: 'brand.subtle' })}
              href={back}
            >
              BENCH
            </Button>
          </nav>
          <SessionControls key={pathname} />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={css({
          maxWidth: '80rem',
          mx: 'auto',
          px: { base: '4', tablet: '8' },
          py: { base: '6', tablet: '10' },
        })}
      >
        <Routes>
          <Route path="/" element={<Navigate to={'/bench/' + search} replace />} />
          <Route
            path="/bench"
            element={
              <PageTitle title="Benchmark">
                <BenchPage url={back} />
              </PageTitle>
            }
          />
          <Route
            path="/bench/runs/:id"
            element={
              validRun ? (
                <PageTitle title="Public run">
                  <RunPage id={id} back={back} />
                </PageTitle>
              ) : (
                <PageTitle title="Page not found">
                  <NotFoundPage back={back} />
                </PageTitle>
              )
            }
          />
          <Route
            path="/sign-in/*"
            element={
              <PageTitle title="Sign in">
                <SignInPage />
              </PageTitle>
            }
          />
          <Route
            path="/sign-up/*"
            element={
              <PageTitle title="Create account">
                <SignUpPage />
              </PageTitle>
            }
          />
          <Route
            path="*"
            element={
              <PageTitle title="Page not found">
                <NotFoundPage back={back} />
              </PageTitle>
            }
          />
        </Routes>
      </main>
    </>
  );
}
