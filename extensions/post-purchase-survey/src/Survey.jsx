import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { COPY, FOLLOW_UPS, Q2_OPTIONS, shuffledQ1 } from "./questions";
import { sendSurvey, fetchAnswered } from "./api";
import { readAnsweredFlag, writeAnsweredFlag } from "./answered";

const TEXT_DEBOUNCE_MS = 800;

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

  const onQ1Change = (value) => {
    if (!value || value === source) return;
    setSource(value);
    // New source: previous follow-up answers no longer apply.
    setSourceDetail("");
    setSourceText("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    send({ source: value, sourceDetail: "", sourceText: "" });
    writeAnsweredFlag(orderId);
  };

  const onDetailChange = (value) => {
    if (!value) return;
    setSourceDetail(value);
    send({ sourceDetail: value });
  };

  const onTextInput = (value) => {
    setSourceText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      send({ sourceText: value });
    }, TEXT_DEBOUNCE_MS);
  };

  const onTextCommit = (value) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSourceText(value);
    send({ sourceText: value });
  };

  const onQ2Change = (value) => {
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

  // Card container approximating the mockup's bordered survey block.
  // Colors/typography come from the store's checkout branding; extensions
  // can only pick from the design-system tokens.
  if (status === "thanks") {
    return (
      <s-box border="base" borderRadius="base" padding="large" background="subdued">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-icon type="check-circle-filled" tone="success" size="large" />
          <s-text type="strong">{COPY.thanks}</s-text>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-box border="base" borderRadius="base" padding="large" background="subdued">
      <s-stack gap="base">
      <s-heading>{COPY.heading}</s-heading>

      <s-choice-list
        label={COPY.q1Label}
        name="source"
        values={source ? [source] : []}
        onChange={(event) => onQ1Change(event.currentTarget.values?.[0])}
      >
        {options.map((option) => (
          <s-choice key={option.value} value={option.value}>
            {option.label}
            {(option.followUp || option.text !== undefined) && (
              <s-stack slot="selectedContent" gap="base">
                {option.followUp && (
                  <s-choice-list
                    label={FOLLOW_UPS[option.followUp].question}
                    name="source-detail"
                    values={sourceDetail ? [sourceDetail] : []}
                    onChange={(event) =>
                      onDetailChange(event.currentTarget.values?.[0])
                    }
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
                    value={sourceText}
                    onInput={(event) => onTextInput(event.currentTarget.value)}
                    onChange={(event) => onTextCommit(event.currentTarget.value)}
                  />
                )}
              </s-stack>
            )}
          </s-choice>
        ))}
      </s-choice-list>

      {source && (
        <>
          {/* Mirrors the mockup's q2-section top border. */}
          <s-divider />
          <s-choice-list
            label={COPY.q2Label}
            name="trigger"
            values={trigger ? [trigger] : []}
            onChange={(event) => onQ2Change(event.currentTarget.values?.[0])}
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
    </s-box>
  );
}
