import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewerProblem, { problemMessage } from '../src/app/components/venue/ViewerProblem';

/**
 * A 3D or 360° view that cannot draw says why and offers a way on — never the
 * dark empty box a buyer on a phone took for a broken site.
 */
describe('ViewerProblem', () => {
  test('a dropped GPU context explains itself and offers both ways on', () => {
    const onRetry = vi.fn();
    const onFallback = vi.fn();
    render(<ViewerProblem kind="lost" onRetry={onRetry} onFallback={onFallback} />);
    expect(screen.getByRole('alert').textContent).toMatch(/stopped drawing the 3D view/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use the 2D map' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledOnce();
  });

  test('WebGL off is not retried: only the way back to the map', () => {
    render(<ViewerProblem kind="nogl" onRetry={() => {}} onFallback={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use the 2D map' })).toBeTruthy();
  });

  test('without a map to go back to (the organizer studio), only Try again', () => {
    render(<ViewerProblem kind="load" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use the 2D map' })).toBeNull();
    expect(screen.getByRole('alert').textContent).not.toMatch(/2D map/);
  });

  test('every kind has its own sentence, and an unknown one still says something', () => {
    const kinds = ['nogl', 'load', 'lost', 'photo'];
    const said = kinds.map((k) => problemMessage(k, '360° view'));
    expect(new Set(said).size).toBe(kinds.length);
    expect(problemMessage('surprise')).toBe(problemMessage('load'));
  });
});
