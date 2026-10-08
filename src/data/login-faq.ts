// FAQ shown on the admin sign-in page. Keep answers true to the product:
// anything not built yet is said so, not promised.

export interface FaqItem {
  question: string;
  answer: string;
}

export const ADMIN_FAQ: FaqItem[] = [
  {
    question: 'How do I sign in?',
    answer:
      'Use the email and password your company was set up with. After several failed attempts, sign-in pauses for a short time.',
  },
  {
    question: 'How do tenants get access?',
    answer:
      'You onboard each tenant from the admin. The tenant gets a one-time password and signs in to the Makazi app with their phone number. They choose their own password on first sign-in.',
  },
  {
    question: 'How is rent calculated each month?',
    answer:
      'Each unit is billed for rent, water (from the meter readings you record) and garbage. Payments are applied to the oldest charges first, so what is left over is the arrears.',
  },
  {
    question: 'How are payments recorded?',
    answer:
      'Payments are recorded against a tenancy with a method (M-Pesa or bank), an amount and a reference. Each payment gets a receipt number. A repeated M-Pesa reference is rejected, so a payment cannot be recorded twice.',
  },
  {
    question: 'Where do deposits go?',
    answer:
      'Deposits are shown separately and are not counted as rent collected.',
  },
  {
    question: 'What reports can I download?',
    answer:
      'CSV reports for the rent roll, collections by month, collections by property, arrears, occupancy and moves, and the maintenance log. Each tenant also has a printable statement that shows your KRA PIN.',
  },
  {
    question: 'Is there an owner statement with deductions and payouts?',
    answer:
      'Not yet. Makazi does not record expenses or payouts, so an owner statement is not available.',
  },
  {
    question: 'Can I see who changed a payment or a rent figure?',
    answer:
      'Changes are recorded, but there is no page in the admin to view them yet.',
  },
  {
    question: 'Can I sign digital leases?',
    answer: 'Lease signing is not turned on yet.',
  },
];
