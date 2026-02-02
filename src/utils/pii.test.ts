import { describe, it, expect } from 'vitest';
import { redactPII, redactTicket, hasPII, getPIITypes } from '../utils/pii.js';

describe('redactPII', () => {
  it('should redact email addresses', () => {
    const text = 'Contact me at user@example.com for help';
    const result = redactPII(text);
    
    expect(result.redacted).toContain('[EMAIL_REDACTED]');
    expect(result.redacted).not.toContain('user@example.com');
    expect(result.redactions).toHaveLength(1);
    expect(result.redactions[0].type).toBe('email');
  });
  
  it('should redact phone numbers', () => {
    const text = 'Call me at 555-123-4567';
    const result = redactPII(text);
    
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redactionCount).toBeGreaterThan(0);
  });
  
  it('should redact credit card numbers', () => {
    const text = 'My card is 4111-1111-1111-1111';
    const result = redactPII(text);
    
    expect(result.redacted).toContain('[CC_REDACTED]');
  });
  
  it('should redact API keys', () => {
    const text = 'My api_key=sk-1234567890abcdefgh';
    const result = redactPII(text);
    
    expect(result.redacted).toContain('[API_KEY_REDACTED]');
  });
  
  it('should redact passwords', () => {
    const text = 'password=mysecretpassword123';
    const result = redactPII(text);
    
    expect(result.redacted).toContain('[PASSWORD_REDACTED]');
  });
  
  it('should handle text without PII', () => {
    const text = 'Just a regular support question about features';
    const result = redactPII(text);
    
    expect(result.redacted).toBe(text);
    expect(result.redactionCount).toBe(0);
  });
  
  it('should redact multiple PII types', () => {
    const text = 'Email: user@example.com, Phone: 555-123-4567, API Key: sk-abc123';
    const result = redactPII(text);
    
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
  });
  
  it('should preserve original text', () => {
    const text = 'Contact: user@example.com';
    const result = redactPII(text);
    
    expect(result.original).toBe(text);
  });
});

describe('redactTicket', () => {
  it('should redact both subject and body', () => {
    const ticket = {
      subject: 'Help with user@example.com',
      body: 'My api_key=sk-jobforge-1234567890abcdefgh is not working',
    };
    
    const result = redactTicket(ticket);
    
    expect(result.subject).toContain('[EMAIL_REDACTED]');
    expect(result.body).toContain('[API_KEY_REDACTED]');
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
  });
  
  it('should handle empty body', () => {
    const ticket = {
      subject: 'Test',
      body: '',
    };
    
    const result = redactTicket(ticket);
    
    expect(result.redactionCount).toBe(0);
  });
});

describe('hasPII', () => {
  it('should detect email in text', () => {
    expect(hasPII('Contact user@example.com')).toBe(true);
  });
  
  it('should detect phone in text', () => {
    expect(hasPII('Call 555-123-4567')).toBe(true);
  });
  
  it('should return false for clean text', () => {
    expect(hasPII('How do I use this feature?')).toBe(false);
  });
});

describe('getPIITypes', () => {
  it('should identify all PII types present', () => {
    const text = 'Email: user@example.com, Phone: 555-123-4567';
    const types = getPIITypes(text);
    
    expect(types).toContain('email');
    expect(types).toContain('phone');
  });
  
  it('should return empty array for clean text', () => {
    const types = getPIITypes('Regular question');
    
    expect(types).toHaveLength(0);
  });
});
