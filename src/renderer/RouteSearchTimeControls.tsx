import type { JSX } from 'react';
import { addMotisDepartureMinutes, defaultMotisDepartureDateTime } from '../core/motis';

export type RouteSearchTimeMode = 'now' | 'explicit';

export interface RouteSearchTimeControlsProps {
  mode: RouteSearchTimeMode;
  value: string;
  onChange: (value: string) => void;
  onModeChange: (mode: RouteSearchTimeMode) => void;
  disabled?: boolean;
}

function splitDateTime(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time: time.slice(0, 5) };
}

export default function RouteSearchTimeControls({ mode, value, onChange, onModeChange, disabled = false }: RouteSearchTimeControlsProps): JSX.Element {
  const { date, time } = splitDateTime(value);
  const chooseNow = (): void => {
    onModeChange('now');
    onChange(defaultMotisDepartureDateTime());
  };
  const chooseExplicit = (): void => {
    onModeChange('explicit');
    if (!value) onChange(defaultMotisDepartureDateTime());
  };
  const updateDate = (nextDate: string): void => onChange(`${nextDate}T${time || '08:00'}`);
  const updateTime = (nextTime: string): void => onChange(`${date || defaultMotisDepartureDateTime().slice(0, 10)}T${nextTime}`);

  return <fieldset className="route-search-time-controls">
    <legend>출발 시간 · KST</legend>
    <div className="route-search-time-mode" role="group" aria-label="출발 시간 방식">
      <button type="button" disabled={disabled} className={mode === 'now' ? 'is-active' : ''} aria-pressed={mode === 'now'} onClick={chooseNow}>지금 출발</button>
      <button type="button" disabled={disabled} className={mode === 'explicit' ? 'is-active' : ''} aria-pressed={mode === 'explicit'} onClick={chooseExplicit}>시간 지정</button>
    </div>
    {mode === 'now' ? <p className="route-search-time-summary">현재 시각 기준으로 출발합니다.</p> : <div className="route-search-time-fields">
      <label className="field"><span>출발 날짜</span><input type="date" disabled={disabled} value={date} onChange={(event) => updateDate(event.target.value)} /></label>
      <label className="field"><span>출발 시각</span><input type="time" disabled={disabled} value={time} onChange={(event) => updateTime(event.target.value)} /></label>
    </div>}
    <div className="route-search-time-presets" role="group" aria-label="빠른 출발 시간">
      <span>빠른 선택</span>
      {[['+15분', 15], ['+30분', 30], ['+1시간', 60]].map(([label, minutes]) => <button key={label} type="button" disabled={disabled} onClick={() => { onModeChange('explicit'); onChange(addMotisDepartureMinutes(value, Number(minutes))); }}>{label}</button>)}
    </div>
  </fieldset>;
}
