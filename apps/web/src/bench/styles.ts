import { css } from '../../styled-system/css';

export const stack = css({ display: 'grid', gap: '5' });

export const muted = css({ color: 'fg.muted', textStyle: 'body-sm' });

export const grid = css({
  display: 'grid',
  gap: '4',
  gridTemplateColumns: { base: 'minmax(0, 1fr)', tablet: 'repeat(4, minmax(0, 1fr))' },
});
