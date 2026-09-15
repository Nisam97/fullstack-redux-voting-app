import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { calculateRemainingMs, formatTime, getUrgencyState } from '../utils/timerUtils.js';
import './CountdownTimer.css';

/**
 * Reusable Visual Countdown Timer Component
 *
 * Consumes server-authoritative timer info (expiresAt, duration, status).
 * Calculates remaining time from `expiresAt - Date.now()`.
 * Does NOT decrement a local stored Redux value.
 * Does NOT dispatch NEXT or mutate tournament state on zero.
 *
 * @param {object} props
 * @param {object} [props.timer] - Timer object from Redux ({ duration, expiresAt, status })
 * @param {number} [props.duration] - Optional direct duration prop
 * @param {number} [props.expiresAt] - Optional direct expiresAt prop
 * @param {string} [props.status] - Optional direct status prop
 * @param {string} [props.className] - Optional extra CSS class
 */
export default function CountdownTimer({
  timer,
  duration,
  expiresAt,
  status,
  label,
  className = ''
}) {
  const activeStatus = timer?.status || status;
  const activeExpiresAt = timer?.expiresAt !== undefined ? timer.expiresAt : expiresAt;
  const activeDuration = timer?.duration !== undefined ? timer.duration : duration;

  const isRunning = (activeStatus === 'running' || activeStatus === 'revealing') && typeof activeExpiresAt === 'number' && activeExpiresAt > 0;

  const displayLabel = label || (activeStatus === 'revealing' ? 'NEXT ROUND IN' : 'ROUND TIMER');

  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    // Periodic timer checking every 250ms for accurate boundary rendering without clock drift
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      clearInterval(intervalId);
    };
  }, [isRunning, activeExpiresAt]);

  if (!isRunning) {
    return null;
  }

  const remainingMs = calculateRemainingMs(activeExpiresAt, now);

  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const urgency = getUrgencyState(remainingSeconds);
  const formattedDisplay = formatTime(remainingMs);

  // Optional progress percentage if total duration is provided
  const progressPercent = activeDuration && activeDuration > 0
    ? Math.min(100, Math.max(0, (remainingSeconds / activeDuration) * 100))
    : null;

  return (
    <div
      className={`countdown-timer-container countdown-${urgency} ${className}`.trim()}
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${displayLabel}: ${formattedDisplay}`}
    >
      <div className="countdown-timer-badge">
        <Clock className="countdown-timer-icon" size={18} aria-hidden="true" />
        <span className="countdown-timer-label">{displayLabel}</span>
        <span className="countdown-timer-digits" data-testid="countdown-digits">
          {formattedDisplay}
        </span>
      </div>

      {progressPercent !== null && (
        <div className="countdown-timer-progress-track" aria-hidden="true">
          <div
            className="countdown-timer-progress-bar"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}
