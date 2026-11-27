/**
 * Share links on record: made with the planner as it was on Homecoming's Issue 28, Page 4 (synthetic
 * builds from walkTo50, plus enhancements of every kind on the Blaster). They must keep opening as
 * the same builds (tests/invariants.test.ts), and their figures are part of the golden numbers
 * (tests/goldennumbers.test.ts).
 */

/** One recorded link and what the build it opens is known to be. */
export interface RecordedLink {
  link: string; // the share code, as the planner wrote it
  at: string; // the archetype's internal name
  file: string; // a short name for the build, for the golden numbers' files
  endLevel?: number; // the 0-based level the build stops at, when it stops short of 50
  respecTo?: number; // the 0-based level it respecs to, for a Respec build
  alignment?: string; // its alignment, when not Hero
}

// what each link opens, by a sentence that says what is special about the build
export const RECORDED_LINKS: Record<string, RecordedLink> = {
  'a Blaster with set, attuned, boosted, relative-level and common IOs': {
    link: 'eJwdyckuQ1EcwOHfaXv_nafb6baqWo5WUVyxkJyzsvEcEl1IGgRv4Vk8jLk1PACJOZZEnHzLTylFup7bPhjtDvfbW6Od45PhEcGXBeG0osLIr-_1vMiPT-w7FknFzkoqECbm_xESJEiR4tMqRJEhQ44cBT5sFIlSwMenTJl36yEeVaoEBDR4s3EkToMmTVq0GJskkqRF2-nwatNImg4d5pxbk0WyaKdLlxuTR_J06Tl9XmwRKdKnz6JzbUpIiWVnwIBnW0EqDFh1Qq5MjWiNkJAnW4dLMwUXZhrOzQw86ll40PNwrxfgTi_BRK_AWK8BeHvrm4cb_AGLDzCQ',
    at: 'Class_Blaster',
    file: 'blaster-every-enhancement-kind',
  },
  'a Tanker stopped at level 30': {
    link: 'eJw9yEkSwWAQgNGvM_wyIyFaOhxCWbiSnXuYOYdDKGUoLqXKwls-SYWL__ZBzwYOPDwCAhwf_YUjIiIh4WSCEzIyCgp6HM3H-fQoKRkw4GAhLqSmRlEa9tYh6NDQ0vLWGInZWYqkvDRHcp7aRbpsrY_0eWiFVGxsiAy56wgZsbYx3NTgqhP-puFytljN-QKP0RNp',
    at: 'Class_Tanker',
    file: 'tanker-stopped-at-30',
    endLevel: 29,
  },
  'a Peacebringer': {
    link: 'eJwdyEtOwlAUgOG_LT28yxsqYrF4brVghRoHbsmZS1CjJq5GVwQ-UCZo4kidmdx8s88JHJ7cRxfCbwUBF5cCBYQHY0MoUaJChS91EIcaNQICmnyqh3g0adOmS5et-ohPnz4hIUM2WkSKDBkxIiLiQ8tImYh9K-Zdq0iVmJgDa611pI5aCQlv2kAaJBxaKa_aQlqkpEytF-0gHY6tjIxn7SE9MuZWzkoHeANycpa6A_dmF-7MHtyaMdyYCVwbA1fmCP50Br96Aj-6APAvTs8vz_gHH-wj_Q',
    at: 'Class_Peacebringer',
    file: 'peacebringer',
  },
  'an Arachnos Soldier with a branch': {
    link: 'eJwdyDlOw1AUQNH74_hlcubpEYLBEAwGDBhR0LwF0bEL5iwthLGgCBIFEqwC6et0x0UOtwxA_wwESpQoU0aYqw-hSpU6dX7NIY6IiBYtOvxYgAR06NFjwIBvC5GQESMUZcKXVZAKE6ZMiYl51BpSI2bLS1hZA2mQkLDjfVoTaTLzUlIetI20SdnzMj6si3TJyDjw7rWP9DnycnLudIgMyTnxCm51TDCmoOBG1-Dd1uFaN-DNNuHVtuHFduHZ9mFph_Bkx7CwU4Dw8uzi6px_LdIjaQ',
    at: 'Class_Arachnos_Soldier',
    file: 'arachnos-soldier-branch',
  },
  'a Praetorian Corruptor': {
    link: 'eJwdyGkyA0EYgOG3MzNf9n0bESNDGxkMRrqrcqVU-eEItnAxgnAA61EoVV3Pv0f5yr9U5xDeGxAoUMDHR3izLoQSJSpUuDMKUdSo0aBBi6XxEI8WHTr06HFrAiRgwICQkBE3pogUGTFmTETEqy0jZSImTsy1qSJVYmJ2nbWtI3W0k5DwYptIk4R9J-XKtJE2KSkHzrPtIl2OnIyMv1kf6ZNx4uQ82SHekJyc39kGrOwmPNoteLDb8KN34FvvwZeewqc-hA99DO_6FCBYnM0vDP81JSNL',
    at: 'Class_Corruptor',
    file: 'praetorian-corruptor',
    alignment: 'Praetorian',
  },
  'a respec to 50 (Brute)': {
    link: 'eJwdyMkyxFAUgOE_Sef0PE_RWghXdBCky-LU3XsYO49mZquN_QZ08y6qbn27z_M9LmYQPSsI-PiUKCEsrQuhQoUaNZ7UQzwaNGjRosOjBkhAhx49Bgx40BAJGTEiImLCvZaRMhOmTImJ-bJVpErMjpNwp3WkTkLCnvNpm0gT46SkfNg20iblwMm41S7SJSPj0Hm3faTPsZOTc6NDZEjOqVPwZscEYwoKrnUDXu0mLOwWvNht-DO78Gv2YW1msDJH8GNO4NucAYSXc706n_8Dsbsj7A',
    at: 'Class_Brute',
    file: 'brute-respec-to-50',
    respecTo: 49,
  },
};
