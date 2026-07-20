'use client';

import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  DollarSign,
  Download,
  FileQuestion,
  LifeBuoy,
  Lock,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Upload,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { submitFeedbackAction } from '@/app/[lang]/actions/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';

type SupportT = Dictionary['support'];

// Icons live in code (can't go in JSON dictionaries); they pair by index with
// the translated quick-action arrays in `support.quickActions*`.
const TALENT_QUICK_ACTION_ICONS = [Search, Download, ShoppingBag, Lock];
const PHOTOGRAPHER_QUICK_ACTION_ICONS = [Wallet, Upload, DollarSign, ShieldCheck];

interface SupportPageProps {
  userRole: 'talent' | 'photographer';
  isPro?: boolean;
  planName?: string;
}

export function SupportPage({ userRole, isPro = false, planName = 'Free' }: SupportPageProps) {
  const { t } = useTranslations<SupportT>();
  const lp = useLocalizedPath();
  const isPhotographer = userRole === 'photographer';
  const backHref = lp(isPhotographer ? '/dashboard/photographer' : '/dashboard/talent');

  const quickActions = isPhotographer ? t('quickActionsPhotographer') : t('quickActionsTalent');
  const quickActionIcons = isPhotographer
    ? PHOTOGRAPHER_QUICK_ACTION_ICONS
    : TALENT_QUICK_ACTION_ICONS;
  const faqs = isPhotographer ? t('faqsPhotographer') : t('faqsTalent');
  const categories = isPhotographer ? t('categoriesPhotographer') : t('categoriesTalent');

  const [query, setQuery] = useState('');
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredFaqs = query.trim()
    ? faqs.filter(
        (f) =>
          f.question.toLowerCase().includes(query.toLowerCase()) ||
          f.answer.toLowerCase().includes(query.toLowerCase()),
      )
    : faqs;

  const toggleItem = (i: number) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim() || !category || !priority) {
      toast.error(t('fillAllFields'));
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set('category', category);
      formData.set('subject', subject);
      formData.set('description', `${description}\n\nPriority: ${priority}`);
      formData.set('role', userRole);
      if (typeof window !== 'undefined') {
        formData.set('pageUrl', window.location.href);
      }
      await submitFeedbackAction(formData);
      setSubject('');
      setDescription('');
      setCategory('');
      setPriority('');
      toast.success(t('submitSuccess'));
    } catch {
      toast.error(t('submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <Link
          href={backHref}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('back')}
        </Link>
        <div className="flex items-center gap-3">
          <LifeBuoy className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-4xl font-bold">{t('title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {isPhotographer ? t('subtitlePhotographer') : t('subtitleTalent')}
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('searchPlaceholder')}
          className="pl-9 h-11 rounded-xl bg-muted/40 border-transparent focus-visible:border-input focus-visible:bg-background"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Quick Actions */}
      {!query.trim() && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('quickActionsLabel')}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {quickActions.map((action, i) => {
              const Icon = quickActionIcons[i] ?? FileQuestion;
              return (
                <button
                  key={action.title}
                  type="button"
                  onClick={() => setQuery(action.title.toLowerCase())}
                  className="rounded-xl border bg-muted/30 p-4 text-left transition-colors hover:bg-muted/60"
                >
                  <Icon className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-sm font-medium leading-snug">{action.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {action.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Main two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* FAQ */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('faqsLabel')}
          </h2>

          {filteredFaqs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
              <FileQuestion className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {t('noResultsPrefix')} <span className="font-medium">"{query}"</span>
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {t('clearSearch')}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-xl border overflow-hidden">
              {filteredFaqs.map((faq, i) => (
                <Collapsible
                  key={faq.question}
                  open={openItems.has(i)}
                  onOpenChange={() => toggleItem(i)}
                >
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left text-sm font-medium hover:bg-muted/40 transition-colors">
                    {faq.question}
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                        openItems.has(i) && 'rotate-180',
                      )}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                      {faq.answer}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </section>

        {/* Contact form + support tier */}
        <aside className="flex flex-col gap-4">
          {/* Support tier */}
          <Card className="rounded-xl border shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">{t('supportTier')}</CardTitle>
                <Badge variant={isPro ? 'default' : 'secondary'} className="text-xs">
                  {planName}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {isPhotographer && isPro ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MessageCircle className="h-4 w-4 shrink-0 text-green-600" />
                  <span>
                    {t('prioritySupport')} ·{' '}
                    <span className="font-medium text-foreground">{t('avgResponse2h')}</span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    {t('emailSupport')} ·{' '}
                    <span className="font-medium text-foreground">{t('avgResponse24h')}</span>
                  </span>
                </div>
              )}
              {isPhotographer && !isPro && (
                <Link
                  href={lp('/dashboard/photographer/settings?tab=billing')}
                  className="block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {t('upgradeForPriority')}
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Contact ticket form */}
          <Card className="rounded-xl border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t('submitTicket')}</CardTitle>
              <CardDescription className="text-xs">{t('submitTicketDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="support-subject" className="text-xs">
                    {t('subjectLabel')}
                  </Label>
                  <Input
                    id="support-subject"
                    placeholder={t('subjectPlaceholder')}
                    className="h-9 text-sm"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="support-category" className="text-xs">
                    {t('categoryLabel')}
                  </Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="support-category" className="h-9 text-sm">
                      <SelectValue placeholder={t('categoryPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c} className="text-sm">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="support-description" className="text-xs">
                    {t('descriptionLabel')}
                  </Label>
                  <Textarea
                    id="support-description"
                    placeholder={t('descriptionPlaceholder')}
                    className="min-h-[90px] resize-none text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="support-priority" className="text-xs">
                    {t('priorityLabel')}
                  </Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id="support-priority" className="h-9 text-sm">
                      <SelectValue placeholder={t('priorityPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low" className="text-sm">
                        {t('priorityLow')}
                      </SelectItem>
                      <SelectItem value="medium" className="text-sm">
                        {t('priorityMedium')}
                      </SelectItem>
                      <SelectItem value="high" className="text-sm">
                        {t('priorityHigh')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator className="my-1" />

                <Button type="submit" size="sm" disabled={submitting} className="gap-2">
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? t('sending') : t('send')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
