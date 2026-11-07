import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Download, Volume2, VolumeX, Gauge } from 'lucide-react';
import { post } from '../lib/api';
import { toast } from '../store/ui';
import { fmtDuration } from '../lib/format';
import { Spinner, cx } from './ui';

export interface Segment { speaker: 'agent' | 'customer' | 'system'; text: string; start: number; end: number }

/**
 * Two-lane conversation timeline + synchronized transcript.
 * With a recording: drives an <audio> element (signed, short-lived URL).
 * Without one (simulated calls): plays on a virtual clock and can read lines aloud with the browser’s speech engine.
 */
export function CallPlayer({ callId, segments, duration, recording, agentName }: { callId: string; segments: Segment[]; duration: number; recording?: any; agentName: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string>();
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [speak, setSpeak] = useState(false);
  const total = Math.max(duration || 0, segments.at(-1)?.end ?? 0, 1);
  const hasAudio = recording?.status === 'available' && recording?.canListen;
  const raf = useRef<number>();
  const last = useRef<number>(0);
  const spoken = useRef<number>(-1);
  const listRef = useRef<HTMLOListElement>(null);

  const active = useMemo(() => segments.findIndex((s, i) => t >= s.start && t < (segments[i + 1]?.start ?? s.end + 0.6)), [segments, t]);

  const ensureSrc = useCallback(async () => {
    if (src || !hasAudio) return src;
    setLoadingSrc(true);
    try { const r = await post(`/calls/${callId}/recording-url`, {}); setSrc(r.url); return r.url as string; }
    catch (e: any) { toast.error(e.message); } finally { setLoadingSrc(false); }
  }, [src, hasAudio, callId]);

  // virtual clock for transcript-only playback
  useEffect(() => {
    if (hasAudio || !playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last.current) / 1000) * rate; last.current = now;
      setT((x) => { const n = x + dt; if (n >= total) { setPlaying(false); return total; } return n; });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [playing, hasAudio, rate, total]);

  // read aloud (simulated calls)
  useEffect(() => {
    if (hasAudio || !speak || !playing || active < 0 || spoken.current === active || !('speechSynthesis' in window)) return;
    spoken.current = active;
    const u = new SpeechSynthesisUtterance(segments[active].text);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    u.voice = voices[segments[active].speaker === 'agent' ? 0 : Math.min(1, voices.length - 1)] ?? null;
    u.rate = rate; u.pitch = segments[active].speaker === 'agent' ? 1.05 : 0.9;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }, [active, speak, playing, hasAudio, segments, rate]);
  useEffect(() => () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); }, []);
  useEffect(() => { if (!playing && 'speechSynthesis' in window) speechSynthesis.cancel(); }, [playing]);

  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate, src]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (el && playing) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active, playing]);

  const toggle = async () => {
    if (hasAudio) {
      const s = await ensureSrc(); if (!s || !audio.current) return;
      if (audio.current.paused) { await audio.current.play().catch(() => toast.error('This browser couldn’t play the recording')); } else audio.current.pause();
      return;
    }
    if (t >= total) setT(0);
    spoken.current = -1;
    setPlaying(!playing);
  };
  const seek = (sec: number) => {
    const v = Math.max(0, Math.min(total, sec));
    setT(v); spoken.current = -1;
    if (audio.current && src) audio.current.currentTime = v;
  };
  const download = async () => {
    try { const r = await post(`/calls/${callId}/recording-url`, { download: true }); const a = document.createElement('a'); a.href = r.url; a.click(); }
    catch (e: any) { toast.error(e.message); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(t + 5); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); seek(t - 5); }
  };

  return (
    <section className="panel overflow-hidden" aria-label="Call playback">
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-3">
        <button onClick={toggle} className="h-11 w-11 rounded-full bg-signal text-white flex items-center justify-center hover:bg-signal-ink shrink-0 dark:text-paper" aria-label={playing ? 'Pause' : 'Play'}>
          {loadingSrc ? <Spinner /> : playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
        </button>
        <div className="tnum text-[13px]"><span className="font-semibold">{fmtDuration(t)}</span><span className="text-muted"> / {fmtDuration(total)}</span></div>
        <p className="text-xs text-muted flex-1 min-w-[160px]">{hasAudio ? 'Call recording' : recording?.status === 'pending' ? 'Recording is processing…' : recording && !recording.canListen ? 'Your role can’t play recordings' : 'Simulated call — no audio. Play steps through the transcript.'}</p>
        <button className="btn-ghost btn-sm" onClick={() => setRate(rate >= 2 ? 1 : rate + 0.5)} aria-label={`Playback speed ${rate}x`}><Gauge className="h-4 w-4" /><span className="tnum">{rate}×</span></button>
        {!hasAudio && 'speechSynthesis' in window && <button className={cx('btn-ghost btn-sm', speak && 'text-signal')} onClick={() => setSpeak(!speak)} aria-pressed={speak}>{speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}Read aloud</button>}
        {hasAudio && recording?.canDownload && <button className="btn-ghost btn-sm" onClick={download}><Download className="h-4 w-4" />Download</button>}
      </div>

      {/* Two-lane timeline doubles as the scrubber */}
      <div className="px-5 pb-4">
        <div role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)} aria-valuetext={fmtDuration(t)} onKeyDown={onKey}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left - 76) / (r.width - 84)) * total); }}
          className="relative cursor-pointer select-none rounded-control bg-sunken py-2 pl-[76px] pr-2">
          {(['agent', 'customer'] as const).map((sp) => (
            <div key={sp} className="relative h-6 my-1">
              <span className="absolute -left-[68px] top-1 w-[60px] truncate text-[11px] font-semibold text-muted pointer-events-none">{sp === 'agent' ? agentName : 'Prospect'}</span>
              {segments.map((s, i) => s.speaker === sp && (
                <span key={i} className={cx('absolute top-0 h-6 rounded-[4px] transition-opacity', sp === 'agent' ? 'bg-signal' : 'bg-hot', i === active ? 'opacity-100' : 'opacity-45')}
                  style={{ left: `${(s.start / total) * 100}%`, width: `${Math.max(0.6, ((s.end - s.start) / total) * 100)}%` }} />
              ))}
            </div>
          ))}
          <span className="absolute top-0 bottom-0 w-0.5 bg-ink pointer-events-none" style={{ left: `calc(76px + (100% - 84px) * ${t / total})` }}><span className="absolute -top-1 -left-[4px] h-2.5 w-2.5 rounded-full bg-ink" /></span>
        </div>
      </div>
      {hasAudio && src && <audio ref={audio} src={src} preload="auto" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />}

      <ol ref={listRef} className="border-t border-line max-h-[520px] overflow-y-auto px-2 py-2">
        {segments.map((s, i) => (
          <li key={i} data-i={i}>
            <button onClick={() => seek(s.start)} className={cx('w-full text-left grid grid-cols-[52px_1fr] gap-3 rounded-control px-3 py-2.5', i === active ? 'bg-signal-soft/70' : 'hover:bg-sunken')}>
              <span className="tnum text-xs text-muted pt-0.5">{fmtDuration(s.start)}</span>
              <span className={cx('border-l-[3px] pl-3', s.speaker === 'agent' ? 'border-signal' : 'border-hot')}>
                <span className="block text-[12px] font-semibold text-muted">{s.speaker === 'agent' ? agentName : 'Prospect'}</span>
                <span className="text-[14px] leading-relaxed">{s.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
