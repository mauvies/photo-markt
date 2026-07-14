import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

type FaqItem = { question: string; answer: string };

/**
 * Short objection-handling FAQ for the photographers landing (T-120).
 * Single-open collapsible accordion; content comes from the dictionary
 * (`photographersPage.faqItems`).
 */
export function PhotographersFaq({ title, items }: { title: string; items: FaqItem[] }) {
  return (
    <section id="faq" className="scroll-mt-20 bg-background py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-3xl font-semibold sm:text-4xl">{title}</h2>
        <Accordion type="single" collapsible className="mt-10">
          {items.map((item) => (
            <AccordionItem key={item.question} value={item.question}>
              <AccordionTrigger className="text-base">{item.question}</AccordionTrigger>
              <AccordionContent className="leading-relaxed text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
