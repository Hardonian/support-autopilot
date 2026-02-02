import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface Profile {
  name: string;
  product: {
    name: string;
    description: string;
  };
  terminology: {
    features: Record<string, string>;
    terms: Record<string, string>;
    avoid: string[];
  };
  claims: {
    allowed: string[];
    require_citation: string[];
    prohibited: string[];
  };
  tone: {
    default: 'concise' | 'friendly' | 'technical' | 'empathetic' | 'formal';
    available: ('concise' | 'friendly' | 'technical' | 'empathetic' | 'formal')[];
  };
  escalation: {
    keywords: string[];
    max_urgency: 'low' | 'medium' | 'high' | 'critical';
    auto_escalate: boolean;
  };
}

export function loadProfile(profilePath: string): Profile {
  const fullPath = resolve(profilePath);
  const content = readFileSync(fullPath, 'utf-8');
  return JSON.parse(content) as Profile;
}

export function getDefaultProfile(): Profile {
  return {
    name: 'base',
    product: {
      name: 'Product',
      description: 'A software product',
    },
    terminology: {
      features: {},
      terms: {},
      avoid: [],
    },
    claims: {
      allowed: [],
      require_citation: [],
      prohibited: [],
    },
    tone: {
      default: 'friendly',
      available: ['concise', 'friendly', 'technical', 'empathetic', 'formal'],
    },
    escalation: {
      keywords: ['urgent', 'critical', 'outage', 'security'],
      max_urgency: 'critical',
      auto_escalate: false,
    },
  };
}

export function validateClaimAgainstProfile(
  claim: string,
  profile: Profile
): { valid: boolean; reason?: string } {
  const lowerClaim = claim.toLowerCase();
  
  for (const prohibited of profile.claims.prohibited) {
    if (lowerClaim.includes(prohibited.toLowerCase())) {
      return { valid: false, reason: `Claim contains prohibited term: ${prohibited}` };
    }
  }
  
  const requiresCitation = profile.claims.require_citation.some(term =>
    lowerClaim.includes(term.toLowerCase())
  );
  
  if (requiresCitation) {
    return { valid: true, reason: 'Citation required for this claim' };
  }
  
  return { valid: true };
}
