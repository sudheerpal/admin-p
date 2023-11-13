
const PREFIX = 'bueno';

function prefixed(collection) {
    return `${process.env.MONGO_COLLECTIONS_PREFIX || PREFIX}_${collection}`.toLowerCase().trim();
}

module.exports = {
    prefixed,
    COLLECTION_PUSH: prefixed('push'),
    COLLECTION_USERS: prefixed('users'),
    COLLECTION_STORES: prefixed('stores'),
    COLLECTION_PARAMS: prefixed('params'),
    COLLECTION_SLIDES: prefixed('slides'),
    COLLECTION_BANNERS: prefixed('banners'),
    COLLECTION_METRICS: prefixed('metrics'),
    COLLECTION_CLASSES: prefixed('classes'),
    COLLECTION_BRANCHES: prefixed('branches'),
    COLLECTION_PRODUCTS: prefixed('products'),
    COLLECTION_CATEGORIES: prefixed('categories'),
    COLLECTION_REELS_LIKES: prefixed('reels_likes'),
    COLLECTION_USERS_ORDERS: prefixed('users_orders'),
    COLLECTION_USERS_STREAKS: prefixed('users_streaks'),
    COLLECTION_VENDOR_REELS: prefixed('vendor_reels'),
    COLLECTION_BRANCHES_RANKS: prefixed('branches_ranks'),
    COLLECTION_STORES_ORDERS: prefixed('stores_orders'),
    COLLECTION_BRANCHES_CATEGORIES: prefixed('branches_categories')
};