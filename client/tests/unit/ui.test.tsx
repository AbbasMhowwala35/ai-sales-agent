import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagInput, ScoreBar, TempPill, Empty, Pagination } from '../../src/components/ui';
import { fmtDuration, timeAgo, sourceLabel } from '../../src/lib/format';
import { qs } from '../../src/lib/api';
import { CallPlayer } from '../../src/components/CallPlayer';
import { useState } from 'react';

describe('formatting helpers', () => {
  it('formats durations and sources', () => {
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(125)).toBe('2:05');
    expect(sourceLabel('google_places')).toBe('Google Places');
    expect(timeAgo(new Date())).toBe('just now');
  });
  it('builds query strings without empty values', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: ['x', 'y'], e: [] })).toBe('?a=1&d=x%2Cy');
    expect(qs({})).toBe('');
  });
});

describe('UI primitives', () => {
  it('TagInput adds on Enter and comma, removes on click', () => {
    function Host() { const [v, setV] = useState<string[]>(['Retail']); return <TagInput value={v} onChange={setV} placeholder="add" />; }
    render(<Host />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Healthcare' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Healthcare')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'A, B' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(screen.getByText('A')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove Retail'));
    expect(screen.queryByText('Retail')).not.toBeInTheDocument();
  });
  it('ScoreBar and TempPill render accessible values', () => {
    render(<><ScoreBar score={72} /><TempPill t="hot" /></>);
    expect(screen.getByTitle('Fit score 72/100')).toBeInTheDocument();
    expect(screen.getByText('Hot')).toBeInTheDocument();
  });
  it('Empty state shows guidance and action', () => {
    render(<Empty title="No leads yet" action={<button>Find leads</button>}>Run discovery.</Empty>);
    expect(screen.getByText('Run discovery.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find leads' })).toBeInTheDocument();
  });
  it('Pagination pages forward and back', () => {
    const onPage = vi.fn();
    render(<Pagination page={2} total={60} limit={25} onPage={onPage} />);
    expect(screen.getByText('26–50 of 60')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next page'));
    fireEvent.click(screen.getByLabelText('Previous page'));
    expect(onPage.mock.calls).toEqual([[3], [1]]);
  });
});

describe('CallPlayer', () => {
  const segments = [
    { speaker: 'agent' as const, text: 'Hi, this is Aria, an AI assistant.', start: 0, end: 3 },
    { speaker: 'customer' as const, text: 'Sure, go ahead.', start: 4, end: 6 },
    { speaker: 'agent' as const, text: 'Great, thanks!', start: 7, end: 9 },
  ];
  it('renders transcript in both lanes and seeks when a line is clicked', () => {
    render(<CallPlayer callId="c1" segments={segments} duration={10} agentName="Aria" />);
    expect(screen.getAllByText('Aria').length).toBeGreaterThan(1);
    expect(screen.getByText('Sure, go ahead.')).toBeInTheDocument();
    expect(screen.getByText(/Simulated call/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Great, thanks!'));
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '7');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '2');
  });
  it('explains when the role cannot listen', () => {
    render(<CallPlayer callId="c1" segments={segments} duration={10} agentName="Aria" recording={{ status: 'available', canListen: false }} />);
    expect(screen.getByText(/can’t play recordings/)).toBeInTheDocument();
  });
});
