import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { COPY, FOLLOW_UPS, Q2_OPTIONS, shuffledQ1 } from "./questions";
import { sendSurvey, fetchAnswered } from "./api";
import { readAnsweredFlag, writeAnsweredFlag } from "./answered";

const TEXT_DEBOUNCE_MS = 800;

// Layout notes (mirrors mockup.html from the spec):
// - The whole survey sits in one bordered, subdued card.
// - Q1 and Q2 use `variant="block"` so each choice renders as its own
//   bordered "option shell" instead of a bare radio row.
// - Follow-ups live in the `selected-content` slot of the chosen option so
//   they only appear under THAT option. Slot names are kebab-case in HTML
//   (`selected-content`, `secondary-content`); the camelCase spelling in the
//   TypeScript types does not match and silently falls into the label slot.
// - Colours come from checkout branding; extensions cannot set custom CSS.

/**
 * Shared survey UI for the Thank-you and Order status pages.
 * One tap on Q1 saves immediately; every later interaction re-sends the
 * full snapshot (the backend upserts by order id). Nothing is required,
 * skipping is always available, and network failures are invisible.
 */
export function Survey({ surface, orderId }) {
  // Shuffle exactly once per mount so the list never jumps mid-interaction.
  const options = useMemo(() => shuffledQ1(), []);

  const [status, setStatus] = useState("loading"); // loading | survey | thanks
  const [source, setSource] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [trigger, setTrigger] = useState("");
  const debounceRef = useRef(null);

  // Already-answered check: local storage flag first (both surfaces),
  // then the backend as source of truth for the order-status page,
  // which may be visited days later in a fresh session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let answered = await readAnsweredFlag(orderId);
      if (!answered && surface === "order_status") {
        answered = await fetchAnswered(orderId, surface);
      }
      if (!cancelled) setStatus(answered ? "thanks" : "survey");
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, surface]);

  // Flush any pending text debounce on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const send = (next) => {
    sendSurvey(orderId, surface, {
      source,
      sourceDetail,
      sourceText,
      trigger,
      ...next,
    });
  };

  const onQ1Change = (event) => {
    const value = event.currentTarget.values?.[0];
    if (!value || value === source) return;
    setSource(value);
    // New source: previous follow-up answers no longer apply.
    setSourceDetail("");
    setSourceText("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    send({ source: value, sourceDetail: "", sourceText: "" });
    writeAnsweredFlag(orderId);
  };

  // The follow-up controls are nested inside the Q1 choice list, so their
  // change/input events would bubble up to onQ1Change. Stop them here.
  const onDetailChange = (event) => {
    event.stopPropagation();
    const value = event.currentTarget.values?.[0];
    if (!value) return;
    setSourceDetail(value);
    send({ sourceDetail: value });
  };

  const onTextInput = (event) => {
    event.stopPropagation();
    const value = event.currentTarget.value;
    setSourceText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      send({ sourceText: value });
    }, TEXT_DEBOUNCE_MS);
  };

  const onTextCommit = (event) => {
    event.stopPropagation();
    const value = event.currentTarget.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSourceText(value);
    send({ sourceText: value });
  };

  const onQ2Change = (event) => {
    const value = event.currentTarget.values?.[0];
    if (!value) return;
    setTrigger(value);
    send({ trigger: value });
    setStatus("thanks");
  };

  const onSkip = () => {
    // Skipping stores no answer data; it only hides the survey for this order.
    writeAnsweredFlag(orderId);
    setStatus("thanks");
  };

  if (status === "loading") return null;

  if (status === "thanks") {
    return (
      <SurveyCard>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-icon type="check-circle-filled" tone="success" size="large" />
          <s-text type="strong">{COPY.thanks}</s-text>
        </s-stack>
      </SurveyCard>
    );
  }

  return (
    <SurveyCard>
      <s-stack gap="base">
        <s-heading>{COPY.heading}</s-heading>

        <s-choice-list
          label={COPY.q1Label}
          name="source"
          variant="block"
          values={source ? [source] : []}
          onChange={onQ1Change}
        >
          {options.map((option) => (
            <s-choice key={option.value} value={option.value}>
              {option.label}
              {(option.followUp || option.text !== undefined) && (
                <s-stack slot="selected-content" gap="base">
                  {option.followUp && (
                    <s-choice-list
                      label={FOLLOW_UPS[option.followUp].question}
                      name="source-detail"
                      values={sourceDetail ? [sourceDetail] : []}
                      onChange={onDetailChange}
                    >
                      {FOLLOW_UPS[option.followUp].options.map((followUp) => (
                        <s-choice key={followUp.value} value={followUp.value}>
                          {followUp.label}
                        </s-choice>
                      ))}
                    </s-choice-list>
                  )}
                  {option.text !== undefined && (
                    <s-text-field
                      label={option.text || COPY.optionalText}
                      name="source-text"
                      value={sourceText}
                      onInput={onTextInput}
                      onChange={onTextCommit}
                    />
                  )}
                </s-stack>
              )}
            </s-choice>
          ))}
        </s-choice-list>

        {source && (
          <>
            <s-divider />
            <s-choice-list
              label={COPY.q2Label}
              name="trigger"
              variant="block"
              values={trigger ? [trigger] : []}
              onChange={onQ2Change}
            >
              {Q2_OPTIONS.map((option) => (
                <s-choice key={option.value} value={option.value}>
                  {option.label}
                </s-choice>
              ))}
            </s-choice-list>
          </>
        )}

        <s-stack direction="inline" justifyContent="end">
          <s-link onClick={onSkip}>{COPY.skip}</s-link>
        </s-stack>
      </s-stack>
    </SurveyCard>
  );
}

/** The bordered, subdued card that wraps every survey state. */
function SurveyCard({ children }) {
  return (
    <s-box border="base" borderRadius="base" padding="base" background="subdued">
      {children}
    </s-box>
  );
}
