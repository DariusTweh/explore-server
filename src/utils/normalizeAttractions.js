function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickLat(product) {
  return (
    toNumber(product?.location?.lat) ??
    toNumber(product?.location?.latitude) ??
    toNumber(product?.coordinates?.lat) ??
    toNumber(product?.coordinates?.latitude) ??
    toNumber(product?.geoCode?.latitude) ??
    toNumber(product?.latitude) ??
    null
  );
}

function pickLng(product) {
  return (
    toNumber(product?.location?.lng) ??
    toNumber(product?.location?.longitude) ??
    toNumber(product?.coordinates?.lng) ??
    toNumber(product?.coordinates?.longitude) ??
    toNumber(product?.geoCode?.longitude) ??
    toNumber(product?.longitude) ??
    null
  );
}

function toFilterItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      name: item?.name || item?.title || "",
      tag: item?.tag || item?.id || item?.value || "",
      count: Number.isFinite(Number(item?.count)) ? Number(item.count) : 0,
    }))
    .filter((item) => item.name && item.tag);
}

export function normalizeAttractions(apiData) {
  const productsRaw = Array.isArray(apiData?.products) ? apiData.products : [];
  const seen = new Set();
  const products = [];

  for (const product of productsRaw) {
    const productId = product?.id ?? product?.productId;
    if (productId === undefined || productId === null) continue;
    const id = String(productId);
    if (seen.has(id)) continue;
    seen.add(id);

    const offerItemIds = [];
    for (const offer of product?.offers || []) {
      for (const item of offer?.items || []) {
        if (item?.id !== undefined && item?.id !== null) {
          offerItemIds.push(String(item.id));
        }
      }
    }

    const flags = Array.isArray(product?.flags)
      ? product.flags.map((flag) => ({
          flag: String(flag?.flag || ""),
          value:
            typeof flag?.value === "boolean"
              ? flag.value
              : flag?.value === undefined || flag?.value === null
                ? null
                : Boolean(flag.value),
          rank: toNumber(flag?.rank),
        }))
      : [];

    products.push({
      id,
      name: product?.name || "Attraction",
      slug: product?.slug || null,
      shortDescription: product?.shortDescription || null,
      image: product?.primaryPhoto?.small || null,
      price: {
        amount: toNumber(product?.representativePrice?.chargeAmount),
        currency: product?.representativePrice?.currency || null,
        publicAmount: toNumber(product?.representativePrice?.publicAmount),
      },
      rating: {
        average: toNumber(product?.reviewsStats?.combinedNumericStats?.average),
        total: toNumber(product?.reviewsStats?.combinedNumericStats?.total),
        allReviewsCount: toNumber(product?.reviewsStats?.allReviewsCount),
        percentage: product?.reviewsStats?.percentage || null,
      },
      location: {
        city: product?.ufiDetails?.bCityName || null,
        ufi: toNumber(product?.ufiDetails?.ufi),
        country: product?.ufiDetails?.url?.country || null,
        lat: pickLat(product),
        lng: pickLng(product),
      },
      flags,
      offerItemIds,
    });

    if (products.length >= 20) break;
  }

  return {
    products,
    meta: {
      page: Number.isFinite(Number(apiData?.page)) ? Number(apiData.page) : 1,
      totalUnfiltered:
        apiData?.filterStats?.unfilteredProductCount !== undefined
          ? toNumber(apiData?.filterStats?.unfilteredProductCount)
          : null,
      totalFiltered:
        apiData?.filterStats?.filteredProductCount !== undefined
          ? toNumber(apiData?.filterStats?.filteredProductCount)
          : null,
    },
    sorters: Array.isArray(apiData?.sorters)
      ? apiData.sorters
          .map((sorter) => ({
            name: sorter?.name || sorter?.label || "",
            value: sorter?.value || sorter?.id || "",
          }))
          .filter((sorter) => sorter.name && sorter.value)
      : [],
    defaultSorter:
      apiData?.defaultSortOption && (apiData.defaultSortOption?.name || apiData.defaultSortOption?.value)
        ? {
            name: apiData.defaultSortOption?.name || apiData.defaultSortOption?.label || "",
            value: apiData.defaultSortOption?.value || apiData.defaultSortOption?.id || "",
          }
        : null,
    filters: {
      typeFilters: toFilterItems(apiData?.filterOptions?.typeFilters),
      labelFilters: toFilterItems(apiData?.filterOptions?.labelFilters),
      ufiFilters: toFilterItems(apiData?.filterOptions?.ufiFilters),
      priceFilters: toFilterItems(apiData?.filterOptions?.priceFilters),
    },
  };
}
