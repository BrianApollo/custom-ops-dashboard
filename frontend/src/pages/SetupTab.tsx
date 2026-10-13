import { useAuth } from '../auth'
import { AdPresets } from '../components/setup/AdPresets'
import { LaunchDefaults } from '../components/setup/LaunchDefaults'
import { ProductDetails } from '../components/setup/ProductDetails'
import type { Product } from '../data'

// Everything set up once per product: its details and pictures, the values its
// campaigns start from, and the ad texts they can be launched with
export function SetupTab({ product }: { product?: Product }) {
  const { user } = useAuth()
  // the API lets only admins write to these tables; everyone else reads
  const canEdit = user?.role === 'admin'

  if (!product) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
        Select a product to see its setup.
      </p>
    )
  }

  return (
    // keyed by product, so nothing typed for one product carries over to the next
    <div key={product.id} className="space-y-6">
      <ProductDetails product={product} canEdit={canEdit} />
      <LaunchDefaults product={product} canEdit={canEdit} />
      <AdPresets product={product} canEdit={canEdit} />
    </div>
  )
}
