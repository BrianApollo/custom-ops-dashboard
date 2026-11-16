import { invalid } from '../lib/errors'

// The transparency declaration every ad set carries, and the check that
// Facebook stored what was sent. Facebook accepts an ad set with or without
// these fields and reports no error, so only reading the ad set back proves it.

export const DEFAULT_DECLARATION_NAME = 'Online Advertising'

export const AU_IDENTITY_MESSAGE = 'Australia needs a regulation identity for this ad account; none was sent'

// the fields read back after the ad set is created
export const DECLARATION_FIELDS = 'dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities'

// Europe's beneficiary and payer are stored and returned by Facebook only when
// the ad set targets a country under those rules, so they are compared only then.
// The list is generous: a country too many only makes the check run more often.
const EU_EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
])

// Facebook adds this category by itself when a verified identity is declared;
// it is the only stored category that was not sent and is still accepted
const ADDED_BY_FACEBOOK = new Set(['VOLUNTARY_VERIFICATION'])

export interface DeclarationInput {
  beneficiaryName?: unknown
  payerName?: unknown
  regionalRegulatedCategories?: unknown
  regionalRegulationIdentities?: unknown
}

export interface Declaration {
  dsa_beneficiary: string
  dsa_payor: string
  regional_regulated_categories?: string[]
  regional_regulation_identities?: unknown
}

export interface Mismatch {
  field: keyof Declaration
  expected: unknown
  actual: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// An identity is the object Facebook stores, such as
// { universal_beneficiary: '<id>', universal_payer: '<id>' }, each value a
// Business Manager id read back from an ad set declared in Ads Manager
const hasIdentity = (value: unknown) =>
  isObject(value) && Object.values(value).some((v) => typeof v === 'string' && v.trim() !== '')

// The declaration params for an ad set targeting `countries` (upper case).
// Throws 422 before any Facebook call when Australia is targeted without an identity.
export function buildDeclaration(a: DeclarationInput, countries: string[]): Declaration {
  const named = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  const beneficiary = named(a.beneficiaryName) ?? DEFAULT_DECLARATION_NAME
  const declaration: Declaration = { dsa_beneficiary: beneficiary, dsa_payor: named(a.payerName) ?? beneficiary }

  const sent = a.regionalRegulatedCategories
  if (sent != null && (!Array.isArray(sent) || sent.some((c) => typeof c !== 'string'))) {
    throw invalid('adSet.regionalRegulatedCategories must be a list of text', 'adSet.regionalRegulatedCategories')
  }
  const categories = new Set((sent as string[] | null | undefined) ?? [])
  if (countries.includes('SG')) categories.add('SINGAPORE_UNIVERSAL')
  if (countries.includes('AU')) {
    if (!hasIdentity(a.regionalRegulationIdentities)) throw invalid(AU_IDENTITY_MESSAGE, 'adSet.regionalRegulationIdentities')
    categories.add('AUSTRALIA_UNIVERSAL')
  }
  if (categories.size) declaration.regional_regulated_categories = [...categories]
  if (a.regionalRegulationIdentities != null) declaration.regional_regulation_identities = a.regionalRegulationIdentities
  return declaration
}

// What Facebook stored that differs from what was sent; empty when it all matches
export function compareDeclaration(sent: Declaration, stored: Record<string, unknown>, countries: string[]): Mismatch[] {
  const out: Mismatch[] = []
  if (countries.some((c) => EU_EEA.has(c))) {
    for (const field of ['dsa_beneficiary', 'dsa_payor'] as const) {
      if (stored[field] !== sent[field]) out.push({ field, expected: sent[field], actual: stored[field] ?? null })
    }
  }
  if (sent.regional_regulated_categories) {
    const want = [...sent.regional_regulated_categories].sort()
    const raw = stored.regional_regulated_categories
    const have = (Array.isArray(raw) ? raw : []).filter((c) => !ADDED_BY_FACEBOOK.has(c)).sort()
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      out.push({ field: 'regional_regulated_categories', expected: want, actual: raw ?? null })
    }
  }
  const identities = sent.regional_regulation_identities
  if (isObject(identities)) {
    const raw = stored.regional_regulation_identities
    const have = isObject(raw) ? raw : {}
    if (Object.entries(identities).some(([key, value]) => have[key] !== value)) {
      out.push({ field: 'regional_regulation_identities', expected: identities, actual: raw ?? null })
    }
  }
  return out
}

// The error text for a declaration Facebook did not store
// `deleted` is null when no delete was tried (an ad set that was only checked)
export function mismatchMessage(mismatches: Mismatch[], adSetId: string, deleted: boolean | null) {
  const fields = mismatches
    .map(({ field, expected, actual }) => `${field} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    .join('; ')
  const after =
    deleted === null
      ? `The ad set ${adSetId} was left as it is; fix or delete it in Ads Manager before launching again.`
      : deleted
        ? `The ad set ${adSetId} was deleted.`
        : `The ad set ${adSetId} could not be deleted; delete it in Ads Manager before launching again.`
  return `Facebook did not store the ad set's declaration: ${fields}. ${after}`
}
