// Survey content and option values. Values are stored in order metafields and
// pushed to Klaviyo, so they must stay in sync with the backend allow-lists in
// app/lib/survey-validation.server.js. Bump SURVEY_VERSION whenever options change.

export const SURVEY_VERSION = 2;

export const COPY = {
  heading: "Quick question",
  q1Label: "How did you first hear about Hemlock & Oak?",
  q2Label: "What made today the day?",
  q3Label: "If you have any suggestions for future products, let us know below:",
  q3FieldLabel: "Your suggestions",
  send: "Send",
  skip: "Skip",
  thanks: "Thank you! That really helps a small team like ours.",
  optionalText: "Tell us more (optional)",
};

// `followUp` references FOLLOW_UPS; `text` is the label for an optional
// free-text field ("" = untitled, uses COPY.optionalText).
export const Q1_OPTIONS = [
  { value: "instagram", label: "Instagram", followUp: "A" },
  { value: "facebook", label: "Facebook", followUp: "A" },
  { value: "pinterest", label: "Pinterest", followUp: "A" },
  { value: "reddit", label: "Reddit", followUp: "A", text: "Which subreddit?" },
  { value: "tiktok", label: "TikTok", followUp: "A" },
  { value: "youtube", label: "YouTube", followUp: "A" },
  { value: "google", label: "Google search", followUp: "B" },
  { value: "friend", label: "A friend or family member" },
  { value: "gift", label: "I received one as a gift" },
  { value: "creator", label: "A creator or influencer", text: "Who?" },
  { value: "article", label: "A blog, article or gift guide", text: "Which one?" },
  { value: "podcast", label: "A podcast", text: "Which one?" },
];

// Always shown last, in this order (never shuffled).
export const Q1_PINNED = [
  { value: "dont_remember", label: "I don't remember" },
  { value: "other", label: "Something else", text: "" },
];

export const FOLLOW_UPS = {
  A: {
    question: "Was it an ad, or a post?",
    options: [
      { value: "ad", label: "An ad" },
      { value: "organic_ho", label: "A post from Hemlock & Oak" },
      { value: "organic_other", label: "Someone else's post" },
      { value: "unsure", label: "Not sure" },
    ],
  },
  B: {
    question: "What were you searching for?",
    options: [
      { value: "brand", label: "Hemlock & Oak by name" },
      { value: "product", label: "Planners or notebooks in general" },
      { value: "unsure", label: "Not sure" },
    ],
  },
};

export const Q2_OPTIONS = [
  { value: "new_year", label: "Getting set up for the new year" },
  { value: "replacing", label: "Replacing my last planner" },
  { value: "gift_for", label: "It's a gift for someone" },
  { value: "offer", label: "A sale or special offer" },
  { value: "new_design", label: "A new colour or layout caught my eye" },
  { value: "other", label: "Something else" },
];

// Fisher-Yates shuffle of the main options, pinned options appended.
// Call once per mount so the list never jumps mid-interaction.
export function shuffledQ1() {
  const shuffled = [...Q1_OPTIONS];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [...shuffled, ...Q1_PINNED];
}
