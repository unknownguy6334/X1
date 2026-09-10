import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

interface StudentGapPost {
  src: string;
  durationMs: number;
  identificationText: string;
  alt: string;
}

const POSTS: StudentGapPost[] = [
  {
    src: '/student-posts/post-01.webp',
    durationMs: 4000,
    identificationText: 'Gap men 11:30 le7ad 4:30 🤦‍♀️',
    alt: 'Student post about a gap from 11:30 to 4:30.',
  },
  {
    src: '/student-posts/post-02.webp',
    durationMs: 4000,
    identificationText: 'Bet3melo eh f gap el 4 w el 5 hours 🤦',
    alt: 'Student post asking what to do during a 4 or 5 hour gap.',
  },
  {
    src: '/student-posts/post-03.webp',
    durationMs: 5000,
    identificationText: 'Gm3a ana 3ndy gaps 4 w 5 s3at anam fen? 😂 Library 3ady?',
    alt: 'Student post joking about having 4 and 5 hour gaps.',
  },
  {
    src: '/student-posts/post-04.webp',
    durationMs: 8000,
    identificationText: 'Tb ana delw2ty gadwaly 3ndy yom fy 3 s3at w nos gap w yom 5 s3at fy haga momken tet3mel fel hwar da wla laa?',
    alt: 'Student post asking whether a schedule with 3.5 and 5 hour gaps can be fixed.',
  },
  {
    src: '/student-posts/post-05.webp',
    durationMs: 8000,
    identificationText: 'كان عندي gap من ١٠ لـ ٤ و نص، في الآخر سقط في المادة اللي كانت الـ lecture بتاعتها من ٤ و ٤ و نص.',
    alt: 'Student post about a gap from 10 to 4:30.',
  },
  {
    src: '/student-posts/post-06.webp',
    durationMs: 11000,
    identificationText: 'جدول الـ freshman نزل اللي عنده 3 gap ساعات يعمل فيهم ايه و في ايام من 8:30 لـ 5:30 يوم طويل جدا غير مشوار البيت يعني اكتر من 12 ساعة بتقضوا الايام دي ازاي مذاكرة و حياتكم و نوم يا ريت خبراتكم',
    alt: 'Real freshman student post about 3 hour gaps and a long 8:30 to 5:30 day.',
  },
  {
    src: '/student-posts/post-07.webp',
    durationMs: 15000,
    identificationText: 'Imagine this: It’s a thursday, you have a 5-hour gap, then you have a lecture on the top floor of the R building. You finally finish your gap, you go up the 4 flights of stairs, then you find your lecture cancelled. Also imagine this happening to you twice in a row.',
    alt: 'Student post describing a 5 hour gap followed by a cancelled lecture.',
  },
  {
    src: '/student-posts/post-08.webp',
    durationMs: 20000,
    identificationText: 'Guys I really don’t understand the amount that it really waste my time for no reason bec there’s two lectures so I went to lecture and waited for dr but dr didn’t show up so it’s mean it’s canceled but again another lecture bardo dr didn’t show up...Leh keda Howa marfood they should’ve mail us!!!! cuz i took a gap a lot like 4-5 hours Fa please please they need to mail us before day',
    alt: 'Student post about wasted time, missed lectures, and 4 to 5 hour gaps.',
  },
];

export const StudentGapPosts: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isTouching, setIsTouching] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);

  const remainingMsRef = useRef(POSTS[0].durationMs);
  const totalDurationRef = useRef(POSTS[0].durationMs);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const isPaused = isHovering || isFocused || isTouching;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const advance = useCallback((direction: 1 | -1) => {
    clearTimer();
    const nextIndex = (currentIndex + direction + POSTS.length) % POSTS.length;
    remainingMsRef.current = POSTS[nextIndex].durationMs;
    totalDurationRef.current = POSTS[nextIndex].durationMs;
    startedAtRef.current = null;
    setProgressPercent(0);
    setCurrentIndex(nextIndex);
  }, [clearTimer, currentIndex]);

  useEffect(() => {
    if (isPaused) {
      if (startedAtRef.current !== null) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAtRef.current));
      }
      startedAtRef.current = null;
      clearTimer();
      return;
    }

    clearTimer();
    startedAtRef.current = Date.now();
    const startMs = startedAtRef.current;
    const initialRemaining = remainingMsRef.current;
    const totalDuration = totalDurationRef.current;

    const updateProgress = () => {
      const elapsedSinceResume = Date.now() - startMs;
      const currentRemaining = Math.max(0, initialRemaining - elapsedSinceResume);
      const elapsedTotal = Math.max(0, totalDuration - currentRemaining);
      const fraction = Math.min(1, Math.max(0, elapsedTotal / totalDuration));
      setProgressPercent(fraction * 100);
    };

    const progressInterval = window.setInterval(updateProgress, 500);
    updateProgress();

    timerRef.current = setTimeout(() => {
      setProgressPercent(100);
      const nextIndex = (currentIndex + 1) % POSTS.length;
      setCurrentIndex(nextIndex);
      remainingMsRef.current = POSTS[nextIndex].durationMs;
      totalDurationRef.current = POSTS[nextIndex].durationMs;
      startedAtRef.current = null;
      setProgressPercent(0);
    }, remainingMsRef.current);

    return () => {
      clearTimer();
      window.clearInterval(progressInterval);
    };
  }, [currentIndex, isPaused, clearTimer]);

  useEffect(() => {
    remainingMsRef.current = POSTS[currentIndex].durationMs;
    totalDurationRef.current = POSTS[currentIndex].durationMs;
    startedAtRef.current = null;
    setProgressPercent(0);
  }, [currentIndex]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const post = POSTS[currentIndex];

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
    setIsTouching(true);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    touchStartXRef.current = null;
    setIsTouching(false);

    if (startX === null || endX === null) return;

    const deltaX = endX - startX;
    if (Math.abs(deltaX) < 45) return;

    if (deltaX < 0) {
      advance(1);
    } else {
      advance(-1);
    }
  };

  return (
    <section
      className="w-full"
      aria-label="Student posts about schedule gaps"
    >
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.18em] text-text-muted">
            Student posts
          </p>
          <p className="mt-1 text-sm sm:text-base font-semibold text-ink">
            We've all had days like this.
          </p>
        </div>
        <span className="shrink-0 text-xs font-mono font-bold text-text-muted" aria-label={`Post ${currentIndex + 1} of ${POSTS.length}`}>
          {currentIndex + 1} / {POSTS.length}
        </span>
      </div>

      <div
        className="student-gap-posts group relative aspect-[16/10] min-h-[180px] sm:aspect-[16/9] sm:min-h-[220px] lg:min-h-[280px] max-h-[310px] flex items-center justify-center overflow-hidden rounded-xl border border-line bg-paper p-2 sm:p-3 lg:p-3"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onFocusCapture={() => setIsFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsFocused(false);
          }
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Progress line above the picture indicating time remaining */}
        <div
          className="absolute top-0 left-0 right-0 h-1 bg-line overflow-hidden z-10"
          role="progressbar"
          aria-label="Student post reading timer progress"
          aria-valuenow={Math.round(progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            key={post.src}
            className="student-gap-post-progress h-full bg-ink origin-left"
            style={{ '--student-gap-post-duration': `${totalDurationRef.current}ms`, animationPlayState: isPaused ? 'paused' : 'running' } as React.CSSProperties}
          />
        </div>

        <img
          key={post.src}
          src={post.src}
          alt={post.alt}
          className="student-gap-post-image block w-full max-w-full max-h-full object-contain rounded-lg"
          draggable={false}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {POSTS.map((item, index) => (
            <span
              key={item.src}
              className={`h-1.5 rounded-full transition-all duration-200 ${index === currentIndex ? 'w-5 bg-ink' : 'w-1.5 bg-line-strong'}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous student post"
            onClick={() => advance(-1)}
            className="min-h-[44px] px-3 rounded-lg border border-line bg-white text-sm font-bold text-ink hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition active:translate-y-px inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Prev</span>
          </button>
          <button
            type="button"
            aria-label="Next student post"
            onClick={() => advance(1)}
            className="min-h-[44px] px-3.5 rounded-lg border border-line bg-white text-sm font-bold text-ink hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition active:translate-y-px inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>Next</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
};
