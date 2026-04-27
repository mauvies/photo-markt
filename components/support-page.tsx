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
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';

// ─── Role-specific content ─────────────────────────────────────────────────────

const TALENT_QUICK_ACTIONS = [
  {
    icon: Search,
    title: 'Missing photo',
    description: 'Report a photo you expected but cannot find',
  },
  {
    icon: Download,
    title: 'Download access',
    description: 'Fix issues with downloading purchased photos',
  },
  {
    icon: ShoppingBag,
    title: 'Order help',
    description: 'Questions about charges, receipts, or refunds',
  },
  {
    icon: Lock,
    title: 'Profile privacy',
    description: 'Control who can see your profile and photos',
  },
];

const TALENT_FAQS = [
  {
    question: 'How do I find photos from my event?',
    answer:
      'Use the Explore page to search by event name, location, or date. Once you find your event, browse the gallery or use AI matching (coming soon) to find photos of yourself automatically.',
  },
  {
    question: "My download isn't working — what do I do?",
    answer:
      'First, check your Orders page to confirm payment was completed. If the order shows as paid but the download fails, try clearing your browser cache or using a different browser. Still stuck? Submit a ticket below.',
  },
  {
    question: 'Can I request a refund?',
    answer:
      'Refunds are available within 48 hours of purchase if the photo quality is significantly different from the watermarked preview. Go to Orders, select the order, and tap "Request refund". Our team reviews all requests within 24 hours.',
  },
  {
    question: 'How do I hide my profile from photographers?',
    answer:
      'Go to Profile → Privacy Settings and toggle "Public profile" off. Your purchases remain intact; photographers just cannot search for your profile directly.',
  },
  {
    question: "Why can't I see all photos from my event?",
    answer:
      'Photographers control photo visibility. Some photos may be set to private, may still be processing, or may have been removed by the photographer. Contact the photographer directly through the event page if you believe photos are missing.',
  },
];

const TALENT_CATEGORIES = [
  'Photo discovery',
  'Orders & payments',
  'Downloads',
  'Account & privacy',
  'Other',
];

const PHOTOGRAPHER_QUICK_ACTIONS = [
  {
    icon: Wallet,
    title: 'Payout status',
    description: 'Check when your next payout will be processed',
  },
  {
    icon: Upload,
    title: 'Upload error',
    description: 'Resolve failed or stuck photo uploads',
  },
  {
    icon: DollarSign,
    title: 'Pricing settings',
    description: 'Help configuring bundles and per-photo prices',
  },
  {
    icon: ShieldCheck,
    title: 'Copyright & watermarks',
    description: 'Protect your work and manage watermark rules',
  },
];

const PHOTOGRAPHER_FAQS = [
  {
    question: 'When will my payout be processed?',
    answer:
      'Payouts are batched and sent every 7 days via Stripe Connect. You need a minimum balance of $10 to trigger a payout. Processing time depends on your bank — typically 2–5 business days after Stripe releases the funds.',
  },
  {
    question: 'Why did my photo upload fail?',
    answer:
      'Common causes: files larger than 50 MB, unsupported formats (only JPEG and PNG are accepted), or a slow/interrupted connection. Try re-uploading in smaller batches. If the problem persists, check the browser console for error codes and include them in a support ticket.',
  },
  {
    question: 'How do I set custom pricing for an event?',
    answer:
      'Open the event from your Events page, go to the Pricing tab, and enable "Custom pricing". You can set a price per individual photo and create bundle tiers. Custom bundles require the Starter or Pro plan.',
  },
  {
    question: 'How does watermarking work?',
    answer:
      'When watermarking is enabled on an event, Picdemi overlays a semi-transparent watermark on all preview images. Buyers receive clean, unwatermarked files after purchase. Toggle watermarking per event in the event settings.',
  },
  {
    question: 'How do I handle a copyright infringement report?',
    answer:
      'Email legal@picdemi.com with the photo URL, your ownership evidence, and your contact details. We respond within 72 hours and will remove content pending investigation if necessary.',
  },
];

const PHOTOGRAPHER_CATEGORIES = [
  'Payouts & billing',
  'Uploads & storage',
  'Pricing & bundles',
  'Watermarks & copyright',
  'Account',
  'Other',
];

// ─── Component ─────────────────────────────────────────────────────────────────

interface SupportPageProps {
  userRole: 'talent' | 'photographer';
  isPro?: boolean;
  planName?: string;
}

export function SupportPage({ userRole, isPro = false, planName = 'Free' }: SupportPageProps) {
  const isPhotographer = userRole === 'photographer';
  const backHref = isPhotographer ? '/dashboard/photographer' : '/dashboard/talent';

  const quickActions = isPhotographer ? PHOTOGRAPHER_QUICK_ACTIONS : TALENT_QUICK_ACTIONS;
  const faqs = isPhotographer ? PHOTOGRAPHER_FAQS : TALENT_FAQS;
  const categories = isPhotographer ? PHOTOGRAPHER_CATEGORIES : TALENT_CATEGORIES;

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
      toast.error('Please fill in all fields.');
      return;
    }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 800));
    setSubmitting(false);
    setSubject('');
    setDescription('');
    setCategory('');
    setPriority('');
    toast.success("Ticket submitted — we'll be in touch soon.");
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
          Back to dashboard
        </Link>
        <div className="flex items-center gap-3">
          <LifeBuoy className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-3xl font-semibold">Support</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {isPhotographer
            ? 'Get help with payouts, uploads, pricing, and more.'
            : 'Find answers about your photos, orders, and account.'}
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search help articles..."
          className="pl-9 h-11 rounded-xl bg-muted/40 border-transparent focus-visible:border-input focus-visible:bg-background"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Quick Actions */}
      {!query.trim() && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quick actions
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {quickActions.map((action) => (
              <button
                key={action.title}
                type="button"
                onClick={() => setQuery(action.title.toLowerCase())}
                className="rounded-xl border bg-muted/30 p-4 text-left transition-colors hover:bg-muted/60"
              >
                <action.icon className="mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium leading-snug">{action.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {action.description}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Main two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* FAQ */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Frequently asked questions
          </h2>

          {filteredFaqs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
              <FileQuestion className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No articles match <span className="font-medium">"{query}"</span>
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Clear search
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
                <CardTitle className="text-sm font-semibold">Support tier</CardTitle>
                <Badge variant={isPro ? 'default' : 'secondary'} className="text-xs">
                  {planName}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {isPhotographer && isPro ? (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MessageCircle className="h-4 w-4 shrink-0 text-green-600" />
                    <span>
                      Priority support ·{' '}
                      <span className="font-medium text-foreground">Avg. 2h response</span>
                    </span>
                  </div>
                  <a
                    href="https://wa.me/message/picdemi-support"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      buttonVariants({ size: 'sm' }),
                      'w-full gap-2 bg-green-600 hover:bg-green-700 text-white',
                    )}
                  >
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp direct support
                  </a>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    Email support ·{' '}
                    <span className="font-medium text-foreground">Avg. 24h response</span>
                  </span>
                </div>
              )}
              {isPhotographer && !isPro && (
                <Link
                  href="/dashboard/photographer/settings?tab=billing"
                  className="block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Upgrade to Pro for priority support →
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Contact ticket form */}
          <Card className="rounded-xl border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Submit a ticket</CardTitle>
              <CardDescription className="text-xs">
                Describe your issue and we'll get back to you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="support-subject" className="text-xs">
                    Subject
                  </Label>
                  <Input
                    id="support-subject"
                    placeholder="Brief summary of your issue"
                    className="h-9 text-sm"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="support-category" className="text-xs">
                    Category
                  </Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="support-category" className="h-9 text-sm">
                      <SelectValue placeholder="Select category" />
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
                    Description
                  </Label>
                  <Textarea
                    id="support-description"
                    placeholder="Include relevant details — event name, order ID, error message…"
                    className="min-h-[90px] resize-none text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="support-priority" className="text-xs">
                    Priority
                  </Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id="support-priority" className="h-9 text-sm">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low" className="text-sm">
                        Low — general question
                      </SelectItem>
                      <SelectItem value="medium" className="text-sm">
                        Medium — something isn't working
                      </SelectItem>
                      <SelectItem value="high" className="text-sm">
                        High — blocking my workflow
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator className="my-1" />

                <Button type="submit" size="sm" disabled={submitting} className="gap-2">
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? 'Sending…' : 'Send ticket'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
