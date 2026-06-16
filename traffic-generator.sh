cat > ~/simulate-events.sh << 'EOF'
#!/bin/bash

ENDPOINT="https://realtime-dashboard-backend-947o.onrender.com/webhook"
SECRET="abc123"

PAGES=(
  "Home"
  "Product: Shoes"
  "Product: Bags"
  "Product: Hats"
  "Product: Jackets"
  "Product: Boots"
  "Product: Sunglasses"
  "Product: Watches"
  "Blog: Trends"
  "Blog: Style Guide"
  "Blog: New Arrivals"
  "Checkout"
  "Cart"
  "Order Confirmation"
  "Search"
  "About"
  "Contact"
  "Category: Sale"
  "Category: New In"
  "Category: Men"
  "Category: Women"
  "Category: Accessories"
  "Account: Login"
  "Account: Register"
  "Account: Orders"
  "Wishlist"
  "Store Locator"
  "Size Guide"
  "Returns"
  "404 Error"
)

URLS=(
  "https://example.com/"
  "https://example.com/products/shoes"
  "https://example.com/products/bags"
  "https://example.com/products/hats"
  "https://example.com/products/jackets"
  "https://example.com/products/boots"
  "https://example.com/products/sunglasses"
  "https://example.com/products/watches"
  "https://example.com/blog/trends"
  "https://example.com/blog/style-guide"
  "https://example.com/blog/new-arrivals"
  "https://example.com/checkout"
  "https://example.com/cart"
  "https://example.com/order-confirmation"
  "https://example.com/search"
  "https://example.com/about"
  "https://example.com/contact"
  "https://example.com/sale"
  "https://example.com/new-in"
  "https://example.com/men"
  "https://example.com/women"
  "https://example.com/accessories"
  "https://example.com/account/login"
  "https://example.com/account/register"
  "https://example.com/account/orders"
  "https://example.com/wishlist"
  "https://example.com/store-locator"
  "https://example.com/size-guide"
  "https://example.com/returns"
  "https://example.com/404"
)

WEIGHTED_INDICES=(
  0 0 0 0 0
  1 1 1
  2 2
  3 3
  4 4
  5
  6
  7
  8 8
  9
  10
  11 11 11
  12 12 12
  13
  14 14
  19 19
  20 20
  17
  18
  21
  15
  25
  22
  29
)

DEVICES=("browser" "browser" "browser" "mobile" "mobile" "tablet")
COUNTRIES=("US" "US" "US" "GB" "GB" "DE" "FR" "CA" "AU" "NL" "ES" "IT" "SE" "NO" "DK")
TRACKING_CODES=("email_spring_sale" "email_spring_sale" "email_new_arrivals" "social_instagram" "social_instagram" "social_tiktok" "paid_google_brand" "paid_google_brand" "paid_google_generic" "paid_meta" "affiliate_partner1" "affiliate_partner2")

send_event() {
  local weight_idx=$((RANDOM % ${#WEIGHTED_INDICES[@]}))
  local idx="${WEIGHTED_INDICES[$weight_idx]}"
  local page="${PAGES[$idx]}"
  local url="${URLS[$idx]}"
  local device="${DEVICES[$((RANDOM % ${#DEVICES[@]}))]}"
  local country="${COUNTRIES[$((RANDOM % ${#COUNTRIES[@]}))]}"
  local tracking="${TRACKING_CODES[$((RANDOM % ${#TRACKING_CODES[@]}))]}"
  local page_view=1
  local product_view=0
  local add_to_cart=0
  local purchase=0

  [[ "$page" == Product* ]]             && product_view=1
  [[ "$page" == "Cart" ]]               && add_to_cart=1
  [[ "$page" == "Checkout" ]]           && purchase=$((RANDOM % 4 == 0 ? 1 : 0))
  [[ "$page" == "Order Confirmation" ]] && purchase=1

  curl -s -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SECRET" \
    -d "{
      \"xdm\": {
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"web\": {
          \"webPageDetails\": {
            \"name\": \"$page\",
            \"URL\": \"$url\",
            \"pageViews\": { \"value\": $page_view }
          }
        },
        \"commerce\": {
          \"productViews\":    { \"value\": $product_view },
          \"productListAdds\": { \"value\": $add_to_cart },
          \"purchases\":       { \"value\": $purchase }
        },
        \"environment\": { \"type\": \"$device\" },
        \"placeContext\": { \"geo\": { \"countryCode\": \"$country\" } },
        \"trackingCode\": \"$tracking\"
      }
    }" > /dev/null

  echo "$(date +%H:%M:%S) | $page | $device | $country"
}

echo "Sending to $ENDPOINT"
echo "---"

while true; do
  # Pick a random target between 60 and 100 events for this minute
  TARGET=$((RANDOM % 41 + 60))
  DELAY=$(echo "scale=3; 60 / $TARGET" | bc)
  echo "$(date +%H:%M:%S) ── target: $TARGET events/min | delay: ${DELAY}s"

  COUNT=0
  MINUTE_START=$(date +%s)

  while [ $COUNT -lt $TARGET ]; do
    send_event
    COUNT=$((COUNT + 1))
    sleep $DELAY
  done

  # Wait out the rest of the minute if we finished early
  NOW=$(date +%s)
  ELAPSED=$((NOW - MINUTE_START))
  REMAINING=$((60 - ELAPSED))
  if [ $REMAINING -gt 0 ]; then
    echo "$(date +%H:%M:%S) ── minute done ($COUNT events). Waiting ${REMAINING}s..."
    sleep $REMAINING
  fi
done
EOF

chmod +x ~/simulate-events.sh
~/simulate-events.sh