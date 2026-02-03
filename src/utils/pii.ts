// PII Redaction Helper
// Detects and redacts common PII patterns from support tickets

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // Email addresses
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL_REDACTED]',
  },
  // Phone numbers (various formats)
  {
    name: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  // Credit card numbers (13-19 digits, with or without spaces/dashes)
  {
    name: 'credit_card',
    pattern: /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b|\b\d{13,19}\b/g,
    replacement: '[CC_REDACTED]',
  },
  // Social Security Numbers
  {
    name: 'ssn',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: '[SSN_REDACTED]',
  },
  // API keys (common patterns)
  {
    name: 'api_key',
    pattern: /\b(?:api[_-]?key|apikey)[:\s=]+['"]?[a-zA-Z0-9_-]{16,}['"]?/gi,
    replacement: '[API_KEY_REDACTED]',
  },
  // Passwords in common patterns (handles "password: value", "password = value", "password is value")
  {
    name: 'password',
    pattern: /\b(?:password|passwd|pwd)(?:[:\s=]+|\s+is\s+)['"]?[^\s'"]{8,}['"]?/gi,
    replacement: '[PASSWORD_REDACTED]',
  },
  // IP addresses
  {
    name: 'ip_address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[IP_REDACTED]',
  },
  // Street addresses (simplified pattern)
  {
    name: 'address',
    pattern: /\b\d+\s+[A-Za-z0-9\s.,]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Plaza|Plz|Circle|Cir)\b/gi,
    replacement: '[ADDRESS_REDACTED]',
  },
];

export interface RedactionResult {
  original: string;
  redacted: string;
  redactions: Array<{
    type: string;
    position: [number, number];
    originalValue: string;
  }>;
  redactionCount: number;
}

export function redactPII(text: string): RedactionResult {
  let redacted = text;
  const redactions: RedactionResult['redactions'] = [];
  
  for (const { name, pattern, replacement } of PII_PATTERNS) {
    // Reset lastIndex to start from beginning
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      redactions.push({
        type: name,
        position: [match.index, match.index + match[0].length],
        originalValue: match[0],
      });
      // Prevent infinite loop on zero-length matches
      if (match.index === pattern.lastIndex) {
        pattern.lastIndex++;
      }
    }
    
    // Reset again before replace
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, replacement);
  }
  
  return {
    original: text,
    redacted,
    redactions,
    redactionCount: redactions.length,
  };
}

export function redactTicket(ticket: {
  subject: string;
  body: string;
  customer_email?: string;
  customer_name?: string;
}): {
  subject: string;
  body: string;
  redactionCount: number;
} {
  const subjectResult = redactPII(ticket.subject);
  const bodyResult = redactPII(ticket.body);
  
  return {
    subject: subjectResult.redacted,
    body: bodyResult.redacted,
    redactionCount: subjectResult.redactionCount + bodyResult.redactionCount,
  };
}

export function hasPII(text: string): boolean {
  return PII_PATTERNS.some(({ pattern }) => {
    // Reset lastIndex to avoid state issues with global regex
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function getPIITypes(text: string): string[] {
  const types: string[] = [];
  
  for (const { name, pattern } of PII_PATTERNS) {
    // Reset lastIndex to avoid state issues with global regex
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      types.push(name);
    }
  }
  
  return [...new Set(types)];
}
