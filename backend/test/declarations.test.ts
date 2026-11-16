import { describe, expect, it } from 'vitest'
import { AU_IDENTITY_MESSAGE, buildDeclaration, compareDeclaration, mismatchMessage, type Declaration } from '../src/facebook/declarations'
import { ApiError } from '../src/lib/errors'

// made-up values, shaped like the real ones
const IDENTITY = { universal_beneficiary: '1000000000000001', universal_payer: '1000000000000002' }

describe('buildDeclaration', () => {
  it('names Online Advertising as beneficiary and payer by default', () => {
    expect(buildDeclaration({}, ['US'])).toEqual({ dsa_beneficiary: 'Online Advertising', dsa_payor: 'Online Advertising' })
  })

  it('lets the request name them', () => {
    expect(buildDeclaration({ beneficiaryName: 'Brand Ltd', payerName: 'Payer Ltd' }, ['DE'])).toMatchObject({
      dsa_beneficiary: 'Brand Ltd',
      dsa_payor: 'Payer Ltd',
    })
    expect(buildDeclaration({ beneficiaryName: 'Brand Ltd' }, ['DE'])).toMatchObject({ dsa_beneficiary: 'Brand Ltd', dsa_payor: 'Brand Ltd' })
    expect(buildDeclaration({ beneficiaryName: '', payerName: '' }, ['DE'])).toMatchObject({
      dsa_beneficiary: 'Online Advertising',
      dsa_payor: 'Online Advertising',
    })
  })

  it('adds the Australian category and sends the identity', () => {
    const d = buildDeclaration({ regionalRegulationIdentities: IDENTITY }, ['US', 'AU'])
    expect(d.regional_regulated_categories).toEqual(['AUSTRALIA_UNIVERSAL'])
    expect(d.regional_regulation_identities).toEqual(IDENTITY)
  })

  it('refuses Australia without an identity, with a 422', () => {
    for (const identities of [undefined, null, {}, { universal_beneficiary: '' }, 'text', ['1000000000000001']]) {
      let error: unknown
      try {
        buildDeclaration({ regionalRegulationIdentities: identities }, ['AU'])
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(422)
      expect((error as ApiError).message).toBe(AU_IDENTITY_MESSAGE)
    }
  })

  it('keeps Singapore as it was', () => {
    expect(buildDeclaration({}, ['SG'])).toEqual({
      dsa_beneficiary: 'Online Advertising',
      dsa_payor: 'Online Advertising',
      regional_regulated_categories: ['SINGAPORE_UNIVERSAL'],
    })
    expect(buildDeclaration({ regionalRegulatedCategories: ['SINGAPORE_UNIVERSAL'] }, ['SG']).regional_regulated_categories).toEqual([
      'SINGAPORE_UNIVERSAL',
    ])
  })

  it('keeps requested categories and adds the country ones once', () => {
    const d = buildDeclaration({ regionalRegulatedCategories: ['US_FINANCIAL_SECURITIES'], regionalRegulationIdentities: IDENTITY }, ['AU', 'SG'])
    expect(d.regional_regulated_categories?.sort()).toEqual(['AUSTRALIA_UNIVERSAL', 'SINGAPORE_UNIVERSAL', 'US_FINANCIAL_SECURITIES'])
  })

  it('refuses categories that are not a list of text', () => {
    expect(() => buildDeclaration({ regionalRegulatedCategories: 'AUSTRALIA_UNIVERSAL' }, ['US'])).toThrow(ApiError)
  })

  it('sends no category for countries without one', () => {
    expect(buildDeclaration({}, ['US', 'DE']).regional_regulated_categories).toBeUndefined()
  })
})

describe('compareDeclaration', () => {
  const countries = ['DE', 'AU']
  const sent: Declaration = {
    dsa_beneficiary: 'Online Advertising',
    dsa_payor: 'Online Advertising',
    regional_regulated_categories: ['AUSTRALIA_UNIVERSAL', 'SINGAPORE_UNIVERSAL'],
    regional_regulation_identities: IDENTITY,
  }
  const stored = {
    dsa_beneficiary: 'Online Advertising',
    dsa_payor: 'Online Advertising',
    regional_regulated_categories: ['AUSTRALIA_UNIVERSAL', 'SINGAPORE_UNIVERSAL'],
    regional_regulation_identities: { ...IDENTITY },
  }

  it('passes when everything was stored', () => {
    expect(compareDeclaration(sent, stored, countries)).toEqual([])
  })

  it('fails on each of the four fields', () => {
    const cases: [keyof Declaration, unknown][] = [
      ['dsa_beneficiary', 'Online Marketing'],
      ['dsa_payor', undefined],
      ['regional_regulated_categories', ['SINGAPORE_UNIVERSAL']],
      ['regional_regulation_identities', { universal_beneficiary: IDENTITY.universal_beneficiary }],
    ]
    for (const [field, value] of cases) {
      const result = compareDeclaration(sent, { ...stored, [field]: value }, countries)
      expect(result.map((m) => m.field)).toEqual([field])
      expect(result[0].expected).toEqual(sent[field])
    }
  })

  it('fails when nothing was stored', () => {
    expect(compareDeclaration(sent, {}, countries).map((m) => m.field)).toEqual([
      'dsa_beneficiary',
      'dsa_payor',
      'regional_regulated_categories',
      'regional_regulation_identities',
    ])
  })

  it('does not care about category order', () => {
    const reordered = { ...stored, regional_regulated_categories: ['SINGAPORE_UNIVERSAL', 'AUSTRALIA_UNIVERSAL'] }
    expect(compareDeclaration(sent, reordered, countries)).toEqual([])
  })

  it('accepts the category Facebook adds by itself, and no other extra', () => {
    const added = [...stored.regional_regulated_categories, 'VOLUNTARY_VERIFICATION']
    expect(compareDeclaration(sent, { ...stored, regional_regulated_categories: added }, countries)).toEqual([])
    const other = [...stored.regional_regulated_categories, 'US_FINANCIAL_SECURITIES']
    expect(compareDeclaration(sent, { ...stored, regional_regulated_categories: other }, countries)).toHaveLength(1)
  })

  it('accepts extra identity keys Facebook returns', () => {
    const extra = { ...stored, regional_regulation_identities: { ...IDENTITY, other: '1' } }
    expect(compareDeclaration(sent, extra, countries)).toEqual([])
  })

  it('compares beneficiary and payer only when a European country is targeted', () => {
    const plain: Declaration = { dsa_beneficiary: 'Online Advertising', dsa_payor: 'Online Advertising' }
    expect(compareDeclaration(plain, {}, ['US'])).toEqual([])
    expect(compareDeclaration(plain, {}, ['US', 'IE']).map((m) => m.field)).toEqual(['dsa_beneficiary', 'dsa_payor'])
  })
})

describe('mismatchMessage', () => {
  it('names each field with what was expected and found, and the delete outcome', () => {
    const text = mismatchMessage([{ field: 'dsa_payor', expected: 'Online Advertising', actual: null }], '120000000000', true)
    expect(text).toContain('dsa_payor expected "Online Advertising", got null')
    expect(text).toContain('was deleted')
    expect(mismatchMessage([], '120000000000', false)).toContain('could not be deleted')
  })
})
