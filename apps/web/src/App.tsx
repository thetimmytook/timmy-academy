import { useEffect } from 'react';

import { css } from '../styled-system/css';

import { lastBrowse } from './bench/navigation';
import { Button } from './elements/Button';
import BenchPage from './pages/BenchPage';
import NotFoundPage from './pages/NotFoundPage';
import RunPage from './pages/RunPage';
import { navigate, useUrl } from './routing';

export default function App() {
  const url = useUrl();
  const path = url.split('?')[0] ?? '/';
  const browse = path === '/bench/' || path === '/bench';
  const search = new URL(url, window.location.origin).search;
  const back = browse ? '/bench/' + search : lastBrowse();
  const detail = /^\/bench\/runs\/(br_[A-Za-z0-9_-]+)\/?$/.exec(path);
  let content = <NotFoundPage back={back} />;
  let title = 'Page not found · Timmy Academy';
  if (browse) {
    content = <BenchPage url={back} />;
    title = 'Benchmark · Timmy Academy';
  } else if (detail?.[1]) {
    content = <RunPage id={detail[1]} back={back} />;
    title = 'Public run · Timmy Academy';
  }

  useEffect(() => {
    if (path === '/') {
      navigate('/bench/' + search, { replace: true });
    }
  }, [path, search]);
  useEffect(() => {
    if (path !== '/') {
      document.title = title;
    }
  }, [path, title]);
  useEffect(() => {
    document.getElementById('main')?.focus();
  }, [path]);

  if (path === '/') {
    return null;
  }
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
          <span
            aria-label="Profile unavailable"
            title="Profiles are not available yet"
            className={css({ ml: 'auto', color: 'fg.muted' })}
          >
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="7" r="4" />
              <path d="M4 22v-4a8 8 0 0 1 16 0v4z" />
            </svg>
          </span>
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
        {content}
      </main>
    </>
  );
}
