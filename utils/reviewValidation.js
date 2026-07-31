function isValidRating(rating) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
}

module.exports = { isValidRating }
