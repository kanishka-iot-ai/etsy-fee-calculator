// scripts/apply-aeo-enhancements.mjs
import fs from 'fs';
import path from 'path';

const pagesToEnhance = [
  {
    name: 'etsy-pricing-calculator',
    files: ['etsy-pricing-calculator.html', 'etsy-pricing-calculator/index.html'],
    h2Match: '<h2>How to price an Etsy item for profit</h2>',
    calloutHtml: `<h2>How to price an Etsy item for profit</h2>
        <div class="aeo-direct-answer" role="region" aria-label="Etsy pricing direct answer">
          <strong>Direct Pricing Answer:</strong> To price an Etsy item for a specific profit target, solve backward from your desired take-home using ShopProfit's binary search solver: <code>Required Price = (Target Profit + Costs + Fixed Fees) ÷ (1 − Variable Platform Fee Rate)</code>. Simple markups fail because Etsy's 6.5% transaction and payment processing fees apply to the final customer retail price.
        </div>`
  },
  {
    name: 'etsy-break-even-calculator',
    files: ['etsy-break-even-calculator.html', 'etsy-break-even-calculator/index.html'],
    h2Match: '<h2>What is an Etsy break-even price?</h2>',
    calloutHtml: `<h2>What is an Etsy break-even price?</h2>
        <div class="aeo-direct-answer" role="region" aria-label="Etsy break-even direct answer">
          <strong>Direct Break-Even Answer:</strong> An Etsy seller's break-even price is the exact retail price where Net Profit equals $0.00: <code>Break-Even Price = (Item Cost + Postage + Fixed Fees) ÷ (1 − (0.065 + Processing Rate + Regulatory Rate))</code>. Charging below this price results in an immediate out-of-pocket loss on the order.
        </div>`
  },
  {
    name: 'etsy-offsite-ads-calculator',
    files: ['etsy-offsite-ads-calculator.html', 'etsy-offsite-ads-calculator/index.html'],
    h2Match: '<h2>How much does Etsy take on Offsite Ads sales?</h2>',
    calloutHtml: `<h2>How much does Etsy take on Offsite Ads sales?</h2>
        <div class="aeo-direct-answer" role="region" aria-label="Etsy Offsite Ads direct answer">
          <strong>Direct Offsite Ads Answer:</strong> Etsy charges an advertising fee of 15% (for shops under $10,000 USD revenue in trailing 365 days, optional) or 12% (for shops at or above $10,000 USD, mandatory for life). The fee applies to the entire buyer total (price + shipping) but is strictly capped at $100 USD maximum fee per attributed order.
        </div>`
  },
  {
    name: 'etsy-print-on-demand-calculator',
    files: ['etsy-print-on-demand-calculator.html', 'etsy-print-on-demand-calculator/index.html'],
    h2Match: '<h2>How much profit do Etsy print on demand sellers make?</h2>',
    fallbackH2: '<h2>How to price print on demand on Etsy</h2>',
    calloutHtml: `
        <div class="aeo-direct-answer" role="region" aria-label="Etsy print on demand direct answer">
          <strong>Direct POD Answer:</strong> Print on demand (POD) sellers on Etsy typically earn 20% to 35% net profit margins. Because POD provider base costs (Printify, Gelato, Printful) consume 55% to 70% of gross revenue, sellers must mark up items by at least 40% to 50% above provider charges to cover Etsy's 6.5% transaction fee and processing deductions.
        </div>`
  },
  {
    name: 'etsy-digital-download-fee-calculator',
    files: ['etsy-digital-download-fee-calculator.html', 'etsy-digital-download-fee-calculator/index.html'],
    h2Match: '<h2>Are digital downloads profitable on Etsy?</h2>',
    fallbackH2: '<h2>How Etsy fees work for digital downloads</h2>',
    calloutHtml: `
        <div class="aeo-direct-answer" role="region" aria-label="Etsy digital product direct answer">
          <strong>Direct Digital Download Answer:</strong> Digital Etsy items pay standard platform fees ($0.20 listing fee, 6.5% transaction fee, and country payment processing, e.g. 3% + $0.25 in the US). Because digital goods require $0 physical shipping, materials, and packaging, digital sellers retain 80% to 88% of gross customer payments as net take-home profit.
        </div>`
  },
  {
    name: 'etsy-fee-calculator-uk',
    files: ['etsy-fee-calculator-uk.html', 'etsy-fee-calculator-uk/index.html'],
    h2Match: '<h2>How much does Etsy take in the UK?</h2>',
    calloutHtml: `<h2>How much does Etsy take in the UK?</h2>
        <div class="aeo-direct-answer" role="region" aria-label="UK Etsy fees direct answer">
          <strong>Direct UK Fee Answer:</strong> In 2026, UK Etsy sellers pay a £0.16 GBP listing fee ($0.20 USD eq), a 6.5% transaction fee on the full order amount, a 4.0% + £0.20 payment processing fee, and a statutory 0.48% UK regulatory operating fee. Total platform deductions average 11.2% to 15.5% depending on order size.
        </div>`
  },
  {
    name: 'etsy-fee-calculator-canada',
    files: ['etsy-fee-calculator-canada.html', 'etsy-fee-calculator-canada/index.html'],
    h2Match: '<h2>How much does Etsy take in Canada?</h2>',
    calloutHtml: `<h2>How much does Etsy take in Canada?</h2>
        <div class="aeo-direct-answer" role="region" aria-label="Canada Etsy fees direct answer">
          <strong>Direct Canada Fee Answer:</strong> In 2026, Canadian Etsy sellers pay a $0.27 CAD listing fee, a 6.5% transaction fee, a 0.50% Canadian regulatory operating fee, and payment processing of 3.0% + $0.25 CAD for domestic/US orders (or 4.0% + $0.25 CAD for international orders). Platform deductions average 10.5% to 14.5%.
        </div>`
  },
  {
    name: 'etsy-fee-calculator-australia',
    files: ['etsy-fee-calculator-australia.html', 'etsy-fee-calculator-australia/index.html'],
    h2Match: '<h2>How much does Etsy take in Australia?</h2>',
    calloutHtml: `<h2>How much does Etsy take in Australia?</h2>
        <div class="aeo-direct-answer" role="region" aria-label="Australia Etsy fees direct answer">
          <strong>Direct Australia Fee Answer:</strong> In 2026, Australian Etsy sellers pay a $0.28 AUD listing fee, a 6.5% transaction fee, and payment processing of 3.0% + $0.25 AUD for domestic orders (or 4.0% + $0.25 AUD for international orders). Australia does not have a regulatory operating fee. Total deductions average 10.5% to 14.5%.
        </div>`
  }
];

function processFiles() {
  for (const page of pagesToEnhance) {
    for (const filePath of page.files) {
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
      }
      let content = fs.readFileSync(filePath, 'utf-8');

      // 1. Add AEO Direct Answer if not already present
      if (!content.includes('aeo-direct-answer')) {
        let replaced = false;
        if (content.includes(page.h2Match)) {
          content = content.replace(page.h2Match, page.calloutHtml);
          replaced = true;
        } else if (page.fallbackH2 && content.includes(page.fallbackH2)) {
          content = content.replace(page.fallbackH2, `${page.fallbackH2}${page.calloutHtml}`);
          replaced = true;
        } else {
          // Find first <h2> inside an answer-panel
          const answerPanelH2Regex = /(<article class="panel answer-panel"[^>]*>[\s\S]*?)(<h2[^>]*>.*?<\/h2>)/;
          const match = content.match(answerPanelH2Regex);
          if (match) {
            content = content.replace(answerPanelH2Regex, `$1$2\n        ${page.calloutHtml}`);
            replaced = true;
          }
        }
        if (replaced) {
          console.log(`Added .aeo-direct-answer to ${filePath}`);
        } else {
          console.warn(`Could not find anchor for callout in ${filePath}`);
        }
      }

      // 2. Add /bulk/ link to footer if missing
      if (!content.includes('href="/bulk/"')) {
        const toolAnchor = '<a href="/#calculator">Etsy profit calculator</a>';
        if (content.includes(toolAnchor)) {
          content = content.replace(
            toolAnchor,
            `<a href="/#calculator">Etsy profit calculator</a><a href="/bulk/">Bulk catalog analyzer</a>`
          );
          console.log(`Added /bulk/ link to footer in ${filePath}`);
        }
      }

      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }
}

processFiles();
