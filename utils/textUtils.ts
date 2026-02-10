/**
 * Replaces placeholders in a message template with actual values.
 * Supported placeholders:
 * - {diff}: The daily usage difference (e.g., 500)
 * - {limit}: The threshold limit (e.g., 300)
 * - {unit}: The unit string (e.g., "kg" or "L")
 * - {text}: The base warning text (optional, if user wants to reuse the 'text' field)
 */
export const formatAnomalyMessage = (
    template: string,
    values: { diff?: number | string; limit?: number | string; unit?: string; text?: string }
): string => {
    let result = template;

    if (values.diff !== undefined) {
        result = result.replace(/{diff}/gi, values.diff.toString());
    }
    if (values.limit !== undefined) {
        result = result.replace(/{limit}/gi, values.limit.toString());
    }
    if (values.unit !== undefined) {
        result = result.replace(/{unit}/gi, values.unit);
    }
    if (values.text !== undefined) {
        result = result.replace(/{text}/gi, values.text);
    }

    return result;
};
