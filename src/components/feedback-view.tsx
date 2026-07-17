'use client';

import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Heart,
  Lightbulb,
  Loader2,
  Smartphone,
  Star,
  Tag,
  ThumbsUp,
  Upload,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { submitFeedbackAction, toggleVoteAction } from '@/app/[lang]/actions/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import type { RoleSlug } from '@/lib/roles';
import { cn } from '@/lib/utils';

type FeedbackT = Dictionary['feedback'];

// ─── Constants ────────────────────────────────────────────────────────────────

type CategoryId = 'bug' | 'feature' | 'general';

// Visual metadata for each category — the label/description text lives in the
// dictionary under `feedback.categories[id]`, paired here by id.
const CATEGORY_META = [
  {
    id: 'bug' as CategoryId,
    icon: AlertCircle,
    iconColor: 'text-red-500',
    selectedBg: 'bg-red-50 dark:bg-red-950/30',
    selectedBorder: 'border-red-500',
  },
  {
    id: 'feature' as CategoryId,
    icon: Lightbulb,
    iconColor: 'text-purple-500',
    selectedBg: 'bg-purple-50 dark:bg-purple-950/30',
    selectedBorder: 'border-purple-500',
  },
  {
    id: 'general' as CategoryId,
    icon: Heart,
    iconColor: 'text-blue-500',
    selectedBg: 'bg-blue-50 dark:bg-blue-950/30',
    selectedBorder: 'border-blue-500',
  },
] as const;

// Visual metadata for roadmap items — title/description/status text lives in the
// dictionary under `feedback.roadmap`, paired here by index.
const ROADMAP_META = [
  {
    key: 'ai_face_recognition',
    icon: Brain,
    status: 'live' as const,
    statusColor: 'bg-green-500/10 text-green-600 dark:text-green-400',
  },
  {
    key: 'mobile_app',
    icon: Smartphone,
    status: 'planned' as const,
    statusColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  {
    key: 'bulk_discounts',
    icon: Tag,
    status: 'planned' as const,
    statusColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
] as const;

const CONFETTI_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ef4444',
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfettiParticles() {
  const particles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        x: Math.cos((i / 22) * Math.PI * 2) * (90 + ((i * 41) % 130)),
        y: Math.sin((i / 22) * Math.PI * 2) * (90 + ((i * 57) % 110)) - 70,
        rotation: (i * 137.5) % 720,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 7 + (i % 5) * 2,
        isCircle: i % 3 !== 0,
        delay: (i / 22) * 0.45,
      })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="feedback-confetti-particle absolute left-1/2 top-1/3"
          style={
            {
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.isCircle ? '50%' : '3px',
              marginLeft: -p.size / 2,
              marginTop: -p.size / 2,
              animationDelay: `${p.delay}s`,
              '--confetti-x': `${p.x}px`,
              '--confetti-y': `${p.y}px`,
              '--confetti-rot': `${p.rotation}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function SuccessState({ onReset }: { onReset: () => void }) {
  const { t } = useTranslations<FeedbackT>();
  return (
    <div className="feedback-animate-fade-up relative flex flex-col items-center justify-center py-24 px-6 text-center overflow-hidden">
      <ConfettiParticles />

      <div
        className="feedback-animate-pop mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/40"
        style={{ animationDelay: '0.1s' }}
      >
        <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
      </div>

      <h2
        className="feedback-animate-fade-up text-2xl font-semibold mb-3"
        style={{ animationDelay: '0.25s' }}
      >
        {t('thankYou')}
      </h2>

      <p
        className="feedback-animate-fade-up text-muted-foreground max-w-sm mb-2"
        style={{ animationDelay: '0.35s' }}
      >
        {t('successLine1')}
      </p>
      <p
        className="feedback-animate-fade-up text-sm text-muted-foreground/70 max-w-xs mb-10"
        style={{ animationDelay: '0.42s' }}
      >
        {t('successLine2')}
      </p>

      <div className="feedback-animate-fade" style={{ animationDelay: '0.55s' }}>
        <Button variant="outline" onClick={onReset}>
          {t('submitAnother')}
        </Button>
      </div>
    </div>
  );
}

function StarRating({
  value,
  hovered,
  onChange,
  onHover,
  onLeave,
}: {
  value: number;
  hovered: number;
  onChange: (v: number) => void;
  onHover: (v: number) => void;
  onLeave: () => void;
}) {
  const { t } = useTranslations<FeedbackT>();
  const labels = t('ratingLabels');
  const display = hovered || value;

  return (
    <div className="flex items-center gap-3">
      <fieldset
        className="flex gap-0.5 border-0 p-0 m-0"
        aria-label={t('starRatingAria')}
        onMouseLeave={onLeave}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => onHover(star)}
            className="p-0.5 transition-transform hover:scale-110 focus:outline-none"
            aria-label={labels[star - 1]}
          >
            <Star
              className={cn(
                'h-7 w-7 transition-colors',
                star <= display
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/30 hover:text-muted-foreground/50',
              )}
            />
          </button>
        ))}
      </fieldset>
      {display > 0 && (
        // `key={display}` remounts the span on every rating change so the CSS
        // entrance animation re-fires — a cross-fade in of the new label. The
        // framer-motion exit (fade out before the swap) is dropped intentionally
        // (T-135): with a single always-present slot the swap reads as a crossfade.
        <span key={display} className="feedback-star-label text-sm text-muted-foreground">
          {labels[display - 1]}
        </span>
      )}
    </div>
  );
}

function RoadmapSidebar({
  votedFeatures,
  onVote,
  pendingVoteKey,
}: {
  votedFeatures: Set<string>;
  onVote: (key: string) => void;
  pendingVoteKey: string | null;
}) {
  const { t } = useTranslations<FeedbackT>();
  const roadmap = t('roadmap');

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4 lg:sticky lg:top-4 self-start">
      <div>
        <h3 className="font-semibold text-sm">{t('roadmapTitle')}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t('roadmapSubtitle')}</p>
      </div>

      <Separator />

      <div className="space-y-5">
        {ROADMAP_META.map((meta, i) => {
          const item = roadmap[i];
          if (!item) return null;
          const voted = votedFeatures.has(meta.key);
          const isPending = pendingVoteKey === meta.key;
          const statusLabel = meta.status === 'live' ? t('statusLive') : t('statusPlanned');

          return (
            <div key={meta.key} className="flex gap-3">
              <div className="mt-0.5 shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                <meta.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {item.description}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span
                    className={cn(
                      'text-[10px] font-medium px-2 py-0.5 rounded-full',
                      meta.statusColor,
                    )}
                  >
                    {statusLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => onVote(meta.key)}
                    disabled={isPending}
                    className={cn(
                      'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-all disabled:opacity-60',
                      voted
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                  >
                    <ThumbsUp className={cn('h-3 w-3', voted && 'fill-current')} />
                    {voted ? t('voted') : t('wantThis')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Separator />

      <p className="text-xs text-muted-foreground text-center leading-relaxed">
        {t('anotherIdeaPrefix')}{' '}
        <span className="text-foreground font-medium">{t('anotherIdeaCta')}</span>
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface FeedbackViewProps {
  userRole: RoleSlug;
  initialVotes: string[];
}

export function FeedbackView({ userRole, initialVotes }: FeedbackViewProps) {
  const { t } = useTranslations<FeedbackT>();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Votes
  const [votedFeatures, setVotedFeatures] = useState(() => new Set(initialVotes));
  const [pendingVoteKey, setPendingVoteKey] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    };
  }, [screenshotPreview]);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('errorImageFile'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('errorScreenshotSize'));
      return;
    }
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshot(file);
    setScreenshotPreview(URL.createObjectURL(file));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleVote = async (featureKey: string) => {
    if (pendingVoteKey === featureKey) return;
    setPendingVoteKey(featureKey);
    const wasVoted = votedFeatures.has(featureKey);

    setVotedFeatures((prev) => {
      const next = new Set(prev);
      if (wasVoted) next.delete(featureKey);
      else next.add(featureKey);
      return next;
    });

    try {
      const result = await toggleVoteAction(featureKey);
      setVotedFeatures((prev) => {
        const next = new Set(prev);
        if (result.voted) next.add(featureKey);
        else next.delete(featureKey);
        return next;
      });
    } catch {
      setVotedFeatures((prev) => {
        const next = new Set(prev);
        if (wasVoted) next.add(featureKey);
        else next.delete(featureKey);
        return next;
      });
      toast.error(t('errorVote'));
    } finally {
      setPendingVoteKey(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) {
      toast.error(t('errorSelectCategory'));
      return;
    }
    if (!subject.trim()) {
      toast.error(t('errorAddSubject'));
      return;
    }
    if (!description.trim()) {
      toast.error(t('errorAddDescription'));
      return;
    }

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('category', category);
        formData.append('rating', rating.toString());
        formData.append('subject', subject.trim());
        formData.append('description', description.trim());
        formData.append('role', userRole);
        formData.append('pageUrl', pathname);
        if (screenshot) formData.append('screenshot', screenshot);

        await submitFeedbackAction(formData);
        setIsSubmitted(true);
      } catch {
        toast.error(t('errorSubmit'));
      }
    });
  };

  const handleReset = () => {
    setCategory(null);
    setRating(0);
    setHoveredStar(0);
    setSubject('');
    setDescription('');
    setScreenshot(null);
    setScreenshotPreview(null);
    setIsSubmitted(false);
  };

  if (isSubmitted) {
    return <SuccessState onReset={handleReset} />;
  }

  const categoryLabels = t('categories');
  const subjectPlaceholders = t('subjectPlaceholders');

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── Main form ── */}
        <div className="flex-1 space-y-7 min-w-0">
          {/* Category selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CATEGORY_META.map((cat) => {
              const selected = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={cn(
                    'flex flex-col gap-2.5 rounded-xl border p-4 text-left transition-all',
                    selected
                      ? cn('border-2', cat.selectedBorder, cat.selectedBg)
                      : 'border-border bg-card hover:bg-muted/30 hover:border-muted-foreground/30',
                  )}
                >
                  <cat.icon className={cn('h-5 w-5', cat.iconColor)} />
                  <div>
                    <p className="font-semibold text-sm">{categoryLabels[cat.id].label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {categoryLabels[cat.id].description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Rating */}
          <div className="space-y-2">
            <Label className="text-sm">
              {t('ratingLabel')}{' '}
              <span className="text-muted-foreground font-normal">{t('optional')}</span>
            </Label>
            <StarRating
              value={rating}
              hovered={hoveredStar}
              onChange={setRating}
              onHover={setHoveredStar}
              onLeave={() => setHoveredStar(0)}
            />
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="feedback-subject">{t('subjectLabel')}</Label>
            <Input
              id="feedback-subject"
              placeholder={
                category ? subjectPlaceholders[category] : t('subjectFallbackPlaceholder')
              }
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="feedback-description">{t('descriptionLabel')}</Label>
            <Textarea
              id="feedback-description"
              placeholder={t('descriptionPlaceholders')[userRole]}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={2000}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right tabular-nums">
              {description.length} / 2000
            </p>
          </div>

          {/* Screenshot upload */}
          <div className="space-y-2">
            <Label>
              {t('screenshotLabel')}{' '}
              <span className="text-muted-foreground font-normal">{t('optional')}</span>
            </Label>

            {screenshotPreview ? (
              <div className="relative inline-flex">
                <div className="relative h-32 w-52 overflow-hidden rounded-xl border border-border">
                  <Image
                    src={screenshotPreview}
                    alt="Screenshot preview"
                    fill
                    className="object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScreenshot(null);
                    setScreenshotPreview(null);
                  }}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-border shadow-sm hover:bg-muted transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="absolute bottom-2 left-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {screenshot?.name}
                  </Badge>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted/20',
                )}
              >
                <Upload className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{t('uploadCta')}</span>{' '}
                  {t('uploadOrDragDrop')}
                </p>
                <p className="text-xs text-muted-foreground">{t('uploadHint')}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    e.target.value = '';
                  }}
                />
              </button>
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={isPending} size="lg" className="min-w-36">
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('sending')}
                </>
              ) : (
                t('send')
              )}
            </Button>
          </div>
        </div>

        {/* ── Roadmap sidebar ── */}
        <div className="lg:w-72 shrink-0">
          <RoadmapSidebar
            votedFeatures={votedFeatures}
            onVote={handleVote}
            pendingVoteKey={pendingVoteKey}
          />
        </div>
      </div>
    </form>
  );
}
