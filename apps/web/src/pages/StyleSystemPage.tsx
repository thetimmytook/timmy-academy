/* Keep token names literal so Panda can generate the page's styles. */
/* eslint-disable sonarjs/no-duplicate-string */
import { useState } from 'react';

import { css } from '../../styled-system/css';
import { badge, panel, tab, tabs, tableRow } from '../../styled-system/recipes';
import { token } from '../../styled-system/tokens';
import { Button } from '../elements/Button';
import { Dropdown } from '../elements/Dropdown';
import { Field } from '../elements/Field';
import { Input } from '../elements/Input';
import { Message } from '../elements/Message';

import type { ReactNode } from 'react';

const row = css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3' });
const stack = css({ display: 'grid', gap: '4' });
const grid = css({
  display: 'grid',
  gridTemplateColumns: { base: '1fr', tablet: 'repeat(2, minmax(0, 1fr))' },
  gap: '4',
});
const muted = css({ color: 'fg.muted', textStyle: 'body-sm' });
const eyebrow = css({ textStyle: 'eyebrow', color: 'brand.default' });
const sections = ['Foundations', 'Typography', 'Actions', 'Surfaces', 'Forms', 'Diagnostics'];

function Section({
  id,
  number,
  title,
  description,
  children,
}: {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={css({ scrollMarginTop: '6', display: 'grid', gap: '6' })}
    >
      <div className={css({ display: 'flex', gap: '4', alignItems: 'baseline' })}>
        <span className={css({ fontFamily: 'mono', textStyle: 'caption', color: 'brand.default' })}>
          {number}
        </span>
        <div>
          <h2 id={`${id}-title`} className={css({ textStyle: 'h2', mb: '1' })}>
            {title}
          </h2>
          <p className={muted}>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Actions() {
  const [message, setMessage] = useState('Try an action. Feedback appears here.');

  return (
    <div className={panel()}>
      <div className={row}>
        <Button
          variant="primary"
          onClick={() => setMessage('Practice started. This is a preview interaction.')}
        >
          Start Practice <span aria-hidden="true">↗</span>
        </Button>
        <Button onClick={() => setMessage('Comparison added to your preview.')}>
          Compare Results
        </Button>
        <Button variant="ghost" onClick={() => setMessage('Preview dismissed.')}>
          Dismiss
        </Button>
        <Button
          variant="danger"
          onClick={() => setMessage('Demo selection cleared. No saved data was changed.')}
        >
          Clear Demo
        </Button>
        <Button disabled>Locked</Button>
        <Button variant="link" href="#forms">
          Explore fields <span aria-hidden="true">→</span>
        </Button>
      </div>
      <p
        role="status"
        className={css({ mt: '5', color: 'fg.muted', textStyle: 'body-sm', minHeight: '1.5rem' })}
      >
        {message}
      </p>
      <div
        className={css({ borderTopWidth: '1px', borderColor: 'border.default', mt: '4', pt: '4' })}
      >
        <p className={css({ textStyle: 'eyebrow', color: 'fg.muted', mb: '3' })}>
          State reference · secondary button
        </p>
        <div className={row}>
          <Button>Default</Button>
          <Button data-hover>Hover</Button>
          <Button data-focus-visible>Keyboard focus</Button>
          <Button data-active>Pressed</Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>
    </div>
  );
}

function Forms() {
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState('Streets · evening run');
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && !name.trim();

  return (
    <form
      className={panel()}
      onSubmit={event => {
        event.preventDefault();
        setSubmitted(true);
        setSaved(Boolean(name.trim()));
      }}
      noValidate
    >
      <div className={grid}>
        <div className={stack}>
          <Field label="Run label">
            <Input
              value={name}
              required
              aria-invalid={invalid}
              aria-describedby="run-label-help"
              onChange={event => {
                setName(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <p
            id="run-label-help"
            className={css({ textStyle: 'caption', color: invalid ? 'danger.fg' : 'fg.muted' })}
          >
            {invalid ? 'Enter a label before saving.' : 'A short name to help you find this run.'}
          </p>
          <Field label="Map">
            <Dropdown defaultValue="streets">
              <option value="streets">Streets of Tarkov</option>
              <option value="woods">Woods</option>
              <option value="customs">Customs</option>
            </Dropdown>
          </Field>
        </div>
        <div className={stack}>
          <Field label="Invalid field example">
            <Input
              defaultValue="not-a-number"
              aria-invalid="true"
              aria-describedby="resolution-error"
            />
            <span
              id="resolution-error"
              className={css({ textStyle: 'caption', color: 'danger.fg' })}
            >
              Error: enter a numeric resolution width.
            </span>
          </Field>
          <Field label="Unavailable setting">
            <Input value="Available after your first run" disabled readOnly />
          </Field>
        </div>
      </div>
      <label
        className={css({
          display: 'flex',
          alignItems: 'center',
          gap: '2',
          my: '5',
          minHeight: '2.75rem',
          textStyle: 'body-sm',
        })}
      >
        <input
          type="checkbox"
          defaultChecked
          className={css({ accentColor: 'brand.default', width: '1.125rem', height: '1.125rem' })}
        />
        Include this run in my comparison
      </label>
      <div className={row}>
        <Button type="submit">Save Preview</Button>
        <p role="status" className={muted}>
          {saved
            ? 'Preview saved for this session. Nothing is published.'
            : 'Demo only. Changes are not stored.'}
        </p>
      </div>
    </form>
  );
}

function Surfaces() {
  const [selected, setSelected] = useState(true);

  return (
    <div className={stack}>
      <div className={grid}>
        <div className={panel()}>
          <p className={eyebrow}>Panel</p>
          <h3 className={css({ textStyle: 'h3', mt: '2', mb: '4' })}>
            A place for useful information.
          </h3>
          <div className={panel({ variant: 'inset' })}>
            <p className={css({ textStyle: 'label', mb: '1' })}>Inset surface</p>
            <p className={muted}>Related details stay close without competing for attention.</p>
          </div>
        </div>
        <button
          className={panel({ variant: 'interactive' })}
          aria-pressed={selected}
          data-selected={selected ? '' : undefined}
          onClick={() => setSelected(!selected)}
        >
          <div className={row}>
            <span className={badge({ tone: selected ? 'success' : 'neutral' })}>
              {selected ? '✓ Selected' : 'Not selected'}
            </span>
            <span className={muted}>Click to toggle</span>
          </div>
          <h3 className={css({ textStyle: 'h3', my: '3' })}>Performance fundamentals</h3>
          <p className={muted}>
            Learn what your frame times are telling you. One shared surface for lessons, practice,
            and diagnostics.
          </p>
        </button>
      </div>
      <div className={row}>
        {(
          [
            { tone: 'success', label: '✓ Completed' },
            { tone: 'info', label: '↗ Recommended' },
            { tone: 'warning', label: '! Needs work' },
            { tone: 'danger', label: '× Failed' },
            { tone: 'neutral', label: 'Locked' },
          ] as const
        ).map(item => (
          <span key={item.label} className={badge({ tone: item.tone })}>
            {item.label}
          </span>
        ))}
      </div>
      <div className={grid}>
        {(
          [
            {
              tone: 'info',
              title: 'Information',
              text: 'Compare runs with the same map and graphics settings.',
            },
            { tone: 'success', title: 'Run complete', text: 'Your capture is ready to review.' },
            {
              tone: 'warning',
              title: 'Check the sample',
              text: 'A short capture may not represent the whole raid.',
            },
            {
              tone: 'danger',
              title: 'Capture unavailable',
              text: 'No frames were recorded. Start a new capture and try again.',
            },
          ] as const
        ).map(item => (
          <Message key={item.tone} tone={item.tone}>
            <h3 className={css({ fontWeight: 600, mb: '1' })}>{item.title}</h3>
            <p>{item.text}</p>
          </Message>
        ))}
      </div>
    </div>
  );
}

function Diagnostics() {
  const [active, setActive] = useState('Overview');
  const options = ['Overview', 'Run details'];

  return (
    <div className={panel()}>
      <div role="tablist" aria-label="Sample result" className={tabs()}>
        {options.map((option, index) => (
          <button
            key={option}
            id={`sample-tab-${index}`}
            role="tab"
            aria-selected={active === option}
            aria-controls={`sample-panel-${index}`}
            tabIndex={active === option ? 0 : -1}
            className={tab()}
            onClick={() => setActive(option)}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                return;
              }

              event.preventDefault();
              let nextIndex;

              if (event.key === 'Home') {
                nextIndex = 0;
              } else if (event.key === 'End') {
                nextIndex = options.length - 1;
              } else {
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                nextIndex = (index + direction + options.length) % options.length;
              }

              const next = options.at(nextIndex);

              if (next) {
                setActive(next);
                document.getElementById(`sample-tab-${nextIndex}`)?.focus();
              }
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <div
        id="sample-panel-0"
        role="tabpanel"
        aria-labelledby="sample-tab-0"
        tabIndex={0}
        hidden={active !== 'Overview'}
        className={css({
          pt: '6',
          _focusVisible: {
            outline: '2px solid',
            outlineColor: 'action.default',
            outlineOffset: '0.25rem',
          },
        })}
      >
        <div
          className={css({
            display: 'grid',
            gridTemplateColumns: { base: '1fr', tablet: 'repeat(3, minmax(0, 1fr))' },
            gap: '4',
          })}
        >
          {[
            { label: 'Average FPS', value: '121', delta: '+12%' },
            { label: '1% low', value: '82', delta: '+18%' },
            { label: '0.1% low', value: '54', delta: '+15%' },
          ].map(metric => (
            <div className={panel({ variant: 'inset' })} key={metric.label}>
              <p className={css({ textStyle: 'eyebrow', color: 'fg.muted', mb: '3' })}>
                {metric.label}
              </p>
              <div className={row}>
                <span className={css({ textStyle: 'metric-xl' })}>{metric.value}</span>
                <span className={badge({ tone: 'success' })}>↗ {metric.delta}</span>
              </div>
              <p className={css({ textStyle: 'caption', color: 'fg.muted', mt: '3' })}>
                vs. sample community average
              </p>
            </div>
          ))}
        </div>
        <div className={css({ mt: '5' })}>
          <div className={row}>
            <p className={eyebrow}>Frame rate</p>
            <span className={badge({ tone: 'neutral' })}>Illustrative data</span>
          </div>
          <svg
            viewBox="0 0 800 170"
            role="img"
            aria-label="Illustrative FPS chart. Solid green series around 120 FPS; dashed blue series around 80 FPS."
            className={css({ width: '100%', height: 'auto', mt: '4', overflow: 'visible' })}
          >
            {[30, 75, 120].map((y, i) => (
              <g key={y}>
                <line x1="42" x2="790" y1={y} y2={y} className={css({ stroke: 'chart.grid' })} />
                <text
                  x="0"
                  y={y + 4}
                  fontSize="12"
                  className={css({ fill: 'fg.muted', fontFamily: 'mono' })}
                >
                  {180 - i * 60}
                </text>
              </g>
            ))}
            <polyline
              points="42,74 65,68 90,83 115,72 140,75 165,60 190,79 215,67 240,82 265,68 290,74 315,50 340,80 365,66 390,74 415,62 440,80 465,69 490,73 515,59 540,76 565,66 590,80 615,72 640,58 665,76 690,69 715,78 740,63 765,72 790,68"
              fill="none"
              strokeWidth="2"
              className={css({ stroke: 'chart.primary' })}
            />
            <polyline
              points="42,105 90,110 140,102 190,108 240,100 290,109 340,104 390,111 440,102 490,107 540,100 590,108 640,103 690,110 740,104 790,106"
              fill="none"
              strokeWidth="2"
              strokeDasharray="6 4"
              className={css({ stroke: 'chart.secondary' })}
            />
            <text x="42" y="155" fontSize="12" className={css({ fill: 'fg.muted' })}>
              0:00
            </text>
            <text x="750" y="155" fontSize="12" className={css({ fill: 'fg.muted' })}>
              10:00
            </text>
          </svg>
          <div className={row}>
            <span className={css({ textStyle: 'caption', color: 'chart.primary' })}>━ FPS</span>
            <span className={css({ textStyle: 'caption', color: 'chart.secondary' })}>
              ┄ 1% low
            </span>
          </div>
        </div>
      </div>
      <div
        id="sample-panel-1"
        role="tabpanel"
        aria-labelledby="sample-tab-1"
        tabIndex={0}
        hidden={active !== 'Run details'}
        className={css({ pt: '5' })}
      >
        <table className={css({ width: '100%' })}>
          <caption
            className={css({ textAlign: 'left', color: 'fg.muted', textStyle: 'body-sm', mb: '4' })}
          >
            Example capture context · fictional run
          </caption>
          <tbody>
            {[
              ['Map', 'Streets of Tarkov'],
              ['Resolution', '2560 × 1440'],
              ['Duration', '10 minutes'],
              ['Graphics preset', 'Custom'],
              ['Run ID', 'demo-001'],
            ].map(([label, value]) => (
              <tr key={label} className={tableRow()}>
                <th scope="row">{label}</th>
                <td className={css({ fontFamily: 'mono' })}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={css({ mt: '5', textStyle: 'caption', color: 'fg.muted' })}>
        Sample values demonstrate the visual system. They are not benchmark findings.
      </p>
    </div>
  );
}

export default function StyleSystemPage() {
  return (
    <>
      <title>Style System · Timmy Academy</title>
      <a
        href="#main-content"
        className={css({
          position: 'absolute',
          top: '4',
          left: '4',
          transform: 'translateY(-200%)',
          zIndex: 10,
          bg: 'bg.elevated',
          p: '3',
          borderRadius: 'md',
          _focus: { transform: 'translateY(0)' },
        })}
      >
        Skip to content
      </a>
      <header
        className={css({
          borderBottomWidth: '1px',
          borderColor: 'border.default',
          bg: 'bg.surface',
        })}
      >
        <div
          className={css({
            maxWidth: '80rem',
            mx: 'auto',
            px: { base: 'page.mobile', tablet: 'page.desktop' },
            minHeight: '4.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '4',
          })}
        >
          <a href="/" className={css({ textStyle: 'h3', letterSpacing: '-0.02em' })}>
            TIMMY <span className={css({ color: 'brand.default' })}>ACADEMY</span>
          </a>
          <span className={badge({ tone: 'neutral' })}>Field manual / 0.1</span>
        </div>
      </header>
      <main
        id="main-content"
        className={css({
          maxWidth: '80rem',
          mx: 'auto',
          px: { base: 'page.mobile', tablet: 'page.desktop' },
          py: { base: '8', tablet: '12' },
        })}
      >
        <div
          className={css({
            mb: '10',
            display: 'grid',
            gridTemplateColumns: { base: '1fr', desktop: '1fr auto' },
            gap: '6',
            alignItems: 'end',
          })}
        >
          <div>
            <p className={eyebrow}>Academy / Design reference</p>
            <h1 className={css({ textStyle: { base: 'h1', tablet: 'display' }, mt: '3', mb: '4' })}>
              Academy style system
            </h1>
            <p className={css({ textStyle: 'body-lg', color: 'fg.muted', maxWidth: '40rem' })}>
              The Timmy Academy style system. Calm surfaces, useful signals, and room for the
              details that matter.
            </p>
          </div>
          <div className={css({ borderLeftWidth: '2px', borderColor: 'brand.default', pl: '4' })}>
            <p className={css({ textStyle: 'label' })}>A living specimen</p>
            <p className={muted}>Dark theme · Interactive examples</p>
          </div>
        </div>
        <nav
          aria-label="Style system sections"
          className={css({
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2',
            pb: '8',
            mb: '10',
            borderBottomWidth: '1px',
            borderColor: 'border.default',
          })}
        >
          {sections.map((section, i) => (
            <Button key={section} href={`#${section.toLowerCase()}`} variant="ghost" size="sm">
              <span
                className={css({
                  color: 'brand.default',
                  fontFamily: 'mono',
                  textStyle: 'caption',
                })}
              >
                0{i + 1}
              </span>
              {section}
            </Button>
          ))}
        </nav>
        <div className={css({ display: 'grid', gap: 'section' })}>
          <Section
            id="foundations"
            number="01"
            title="Foundations"
            description="Near-black neutrals. Color with a purpose. A four-pixel rhythm."
          >
            <div
              className={css({
                display: 'grid',
                gridTemplateColumns: {
                  base: 'repeat(2, minmax(0, 1fr))',
                  tablet: 'repeat(4, minmax(0, 1fr))',
                },
                gap: '3',
              })}
            >
              {(
                [
                  { label: 'Canvas', token: 'bg.canvas' },
                  { label: 'Surface', token: 'bg.surface' },
                  { label: 'Inset', token: 'bg.surfaceSubtle' },
                  { label: 'Elevated', token: 'bg.elevated' },
                  { label: 'Brand / positive', token: 'brand.default' },
                  { label: 'Action / information', token: 'action.default' },
                  { label: 'Warning / attention', token: 'warning.fg' },
                  { label: 'Danger / error', token: 'danger.fg' },
                ] as const
              ).map(swatch => (
                <div
                  key={swatch.token}
                  className={css({
                    border: '1px solid',
                    borderColor: 'border.default',
                    borderRadius: 'md',
                    overflow: 'hidden',
                  })}
                >
                  <div
                    className={css({ height: '4rem' })}
                    style={{ backgroundColor: token.var(`colors.${swatch.token}`) }}
                  />
                  <div className={css({ p: '3', bg: 'bg.surface' })}>
                    <p className={css({ textStyle: 'label' })}>{swatch.label}</p>
                    <p
                      className={css({
                        textStyle: 'caption',
                        color: 'fg.muted',
                        fontFamily: 'mono',
                        mt: '1',
                      })}
                    >
                      {swatch.token}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className={grid}>
              <div className={panel()}>
                <p className={eyebrow}>Spacing · px at a 16px root</p>
                <div
                  className={css({
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'end',
                    gap: '5',
                    mt: '4',
                  })}
                >
                  {[4, 8, 12, 16, 24, 32, 48].map(size => (
                    <div key={size}>
                      <div
                        style={{ height: `${size / 16}rem`, width: `${size / 16}rem` }}
                        className={css({
                          bg: 'brand.subtle',
                          border: '1px solid',
                          borderColor: 'brand.default',
                          mb: '2',
                        })}
                      />
                      <span
                        className={css({
                          textStyle: 'caption',
                          fontFamily: 'mono',
                          color: 'fg.muted',
                        })}
                      >
                        {size}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={panel()}>
                <p className={eyebrow}>Surface rules</p>
                <h3 className={css({ textStyle: 'h3', mt: '3', mb: '2' })}>
                  Structure before decoration.
                </h3>
                <p className={muted}>
                  0.25–0.5rem corners. Quiet borders. Almost no shadows. Reserve rounded pills for
                  compact status labels.
                </p>
              </div>
            </div>
          </Section>
          <Section
            id="typography"
            number="02"
            title="Typography"
            description="IBM Plex Sans for the conversation. IBM Plex Mono for the evidence."
          >
            <div className={grid}>
              <div className={panel()}>
                <p className={eyebrow}>IBM Plex Sans</p>
                <p className={css({ textStyle: 'display', mt: '4' })}>Know your next move.</p>
                <p className={css({ textStyle: 'h1', mt: '4' })}>Learn. Practice. Survive.</p>
                <p className={css({ textStyle: 'h2', mt: '4' })}>Understand the details</p>
                <p className={css({ textStyle: 'h3', mt: '4' })}>Build a useful habit</p>
                <p className={css({ textStyle: 'body-lg', mt: '4' })}>Small improvements add up.</p>
                <p className={css({ textStyle: 'body', mt: '3' })}>
                  A field manual should make the next step easier to understand. Keep language
                  direct and the reading rhythm comfortable.
                </p>
                <p className={css({ textStyle: 'body-sm', color: 'fg.muted', mt: '3' })}>
                  Supporting text · 14 / 21
                </p>
                <p className={css({ textStyle: 'caption', color: 'fg.muted', mt: '2' })}>
                  Caption · 12 / 17
                </p>
              </div>
              <div className={panel()}>
                <p className={eyebrow}>IBM Plex Mono</p>
                <p className={css({ textStyle: 'metric-xl', mt: '4' })}>
                  121.04{' '}
                  <span
                    className={css({ textStyle: 'label', color: 'fg.muted', fontFamily: 'body' })}
                  >
                    FPS
                  </span>
                </p>
                <p className={css({ textStyle: 'metric', mt: '4' })}>16.67 ms</p>
                <p className={css({ fontFamily: 'mono', color: 'fg.muted', my: '4' })}>
                  0123456789
                  <br />
                  2560 × 1440
                  <br />
                  00:10:32
                </p>
                <Message tone="info">
                  <h3 className={css({ fontWeight: 600, mb: '1' })}>Field note</h3>
                  <p>Use mono for measurements, timestamps, and IDs. Keep explanations in Sans.</p>
                </Message>
                <p className={css({ textStyle: 'eyebrow', mt: '6', mb: '2' })}>Signature labels</p>
                <p className={eyebrow}>Lesson 04 · Practice · Skill check</p>
              </div>
            </div>
          </Section>
          <Section
            id="actions"
            number="03"
            title="Actions & states"
            description="One main action per section. Blue links for exploration. Visible keyboard focus."
          >
            <Actions />
          </Section>
          <Section
            id="surfaces"
            number="04"
            title="Surfaces & signals"
            description="A small set of containers shared by every Academy tool."
          >
            <Surfaces />
          </Section>
          <Section
            id="forms"
            number="05"
            title="Forms"
            description="Clear labels, useful feedback, and a comfortable target size."
          >
            <Forms />
          </Section>
          <Section
            id="diagnostics"
            number="06"
            title="Diagnostics"
            description="Technical information with a clear hierarchy. Meaning never depends on color alone."
          >
            <Diagnostics />
          </Section>
        </div>
        <footer
          className={css({
            mt: '16',
            pt: '6',
            borderTopWidth: '1px',
            borderColor: 'border.default',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: '4',
            color: 'fg.muted',
            textStyle: 'caption',
          })}
        >
          <p>Timmy Academy · Style system v0.1</p>
          <a
            href="#main-content"
            className={css({ color: 'action.default', _hover: { textDecoration: 'underline' } })}
          >
            Back to top ↑
          </a>
        </footer>
      </main>
    </>
  );
}
