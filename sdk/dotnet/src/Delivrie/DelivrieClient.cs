#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace Delivrie;

/// <summary>Options for <see cref="DelivrieClient"/>.</summary>
public sealed class DelivrieClientOptions
{
    /// <summary>Defaults to the DELIVRIE_BASE_URL environment variable, then https://delivrie.io/api.</summary>
    public string? BaseUrl { get; set; }

    /// <summary>Per-request timeout. Default 30 seconds.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Retries for rate limits, server and network errors on safe requests. Default 2.</summary>
    public int MaxRetries { get; set; } = 2;

    /// <summary>Your own HttpClient (for proxies, handlers or tests). Its BaseAddress isn't used.</summary>
    public HttpClient? HttpClient { get; set; }

    /// <summary>Extra headers sent with every request.</summary>
    public IDictionary<string, string> Headers { get; set; } = new Dictionary<string, string>();
}

/// <summary>
/// The Delivrie client.
/// <code>
/// var delivrie = new DelivrieClient(Environment.GetEnvironmentVariable("DELIVRIE_API_KEY"));
/// var email = await delivrie.Emails.SendAsync(new { from = "Acme &lt;hi@acme.com&gt;", to = "ada@example.com", subject = "Hello", html = "&lt;p&gt;It works&lt;/p&gt;" });
/// Console.WriteLine(email["id"]);
/// </code>
/// Every method returns the API's JSON as a <see cref="JsonObject"/> or throws <see cref="DelivrieException"/>. Rate
/// limits, server errors and network errors are retried for safe requests, and for sends only with an idempotency key,
/// so a retry never sends an email twice. The client is thread-safe; create one and reuse it.
/// </summary>
public sealed partial class DelivrieClient
{
    /// <summary>The SDK version.</summary>
    public const string Version = "0.1.1";

    /// <summary>The default API address.</summary>
    public const string DefaultBaseUrl = "https://delivrie.io/api";

    private static readonly HttpClient SharedHttp = new HttpClient { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
    private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    private readonly string _apiKey;
    private readonly DelivrieClientOptions _options;
    private readonly HttpClient _http;

    /// <summary>The base URL in use.</summary>
    public string BaseUrl { get; }

    /// <summary>Creates a client. The key falls back to the DELIVRIE_API_KEY environment variable.</summary>
    public DelivrieClient(string? apiKey = null, DelivrieClientOptions? options = null)
    {
        var key = string.IsNullOrEmpty(apiKey) ? Environment.GetEnvironmentVariable("DELIVRIE_API_KEY") : apiKey;
        if (string.IsNullOrEmpty(key))
            throw new ArgumentException("Missing API key. Pass it to new DelivrieClient(key) or set DELIVRIE_API_KEY. Create one at https://delivrie.io/api-keys");
        _apiKey = key!;
        _options = options ?? new DelivrieClientOptions();
        _http = _options.HttpClient ?? SharedHttp;
        BaseUrl = (_options.BaseUrl ?? Environment.GetEnvironmentVariable("DELIVRIE_BASE_URL") ?? DefaultBaseUrl).TrimEnd('/');
    }

    /// <summary>Plan, emails sent this month and today, and credits.</summary>
    public Task<JsonObject> UsageAsync(CancellationToken cancellationToken = default) => RequestAsync("GET", "/usage", null, null, null, cancellationToken);

    /// <summary>Sent, delivered, opened, clicked, bounced and complained totals, e.g. new Dictionary { ["days"] = 30 }.</summary>
    public Task<JsonObject> MetricsAsync(IDictionary<string, object?>? query = null, CancellationToken cancellationToken = default) => RequestAsync("GET", "/metrics", null, query, null, cancellationToken);

    /// <summary>Reads a local file into an attachment: { filename, content } with base64 content.</summary>
    public static Dictionary<string, object> Attachment(string path) => new()
    {
        ["filename"] = System.IO.Path.GetFileName(path),
        ["content"] = Convert.ToBase64String(System.IO.File.ReadAllBytes(path)),
    };

    internal static string Enc(string id)
    {
        if (string.IsNullOrEmpty(id)) throw new ArgumentException("Missing id");
        return Uri.EscapeDataString(id);
    }

    /// <summary>
    /// Calls any API path (relative to the base URL, like "/emails") and returns the decoded JSON. A JSON array
    /// response is returned as { "data": [...] }.
    /// </summary>
    public async Task<JsonObject> RequestAsync(string method, string path, object? body = null, IDictionary<string, object?>? query = null, string? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        var url = new StringBuilder(BaseUrl).Append(path);
        if (query != null)
        {
            var sep = path.Contains('?') ? '&' : '?';
            foreach (var kv in query)
            {
                if (kv.Value is null || (kv.Value is string s && s.Length == 0)) continue;
                var v = kv.Value switch { bool b => b ? "true" : "false", DateTimeOffset d => d.ToString("o"), DateTime d => d.ToString("o"), IFormattable f => f.ToString(null, System.Globalization.CultureInfo.InvariantCulture), _ => kv.Value.ToString() ?? "" };
                url.Append(sep).Append(Uri.EscapeDataString(kv.Key)).Append('=').Append(Uri.EscapeDataString(v));
                sep = '&';
            }
        }
        string? payload = body is null ? null : body is JsonNode node ? node.ToJsonString() : JsonSerializer.Serialize(body, body.GetType(), JsonOptions);
        // GET and DELETE are safe to repeat; POST and PATCH only with an idempotency key.
        bool retryable = method == "GET" || method == "DELETE" || !string.IsNullOrEmpty(idempotencyKey);

        for (int attempt = 0; ; attempt++)
        {
            using var req = new HttpRequestMessage(new HttpMethod(method), url.ToString());
            req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + _apiKey);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            req.Headers.TryAddWithoutValidation("User-Agent", "delivrie-dotnet/" + Version);
            foreach (var h in _options.Headers) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            if (!string.IsNullOrEmpty(idempotencyKey)) req.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
            if (payload != null) req.Content = new StringContent(payload, Encoding.UTF8, "application/json");

            HttpResponseMessage res;
            string text;
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                cts.CancelAfter(_options.Timeout);
                try
                {
                    res = await _http.SendAsync(req, cts.Token).ConfigureAwait(false);
                    text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                }
                catch (Exception e) when (e is HttpRequestException || (e is OperationCanceledException && !cancellationToken.IsCancellationRequested))
                {
                    var err = e is OperationCanceledException
                        ? new DelivrieException($"No response within {_options.Timeout.TotalSeconds:0} seconds", 0, "timeout", e)
                        : new DelivrieException("Couldn't reach Delivrie: " + e.Message, 0, "network_error", e);
                    if (retryable && attempt < _options.MaxRetries) { await Task.Delay(Backoff(attempt), cancellationToken).ConfigureAwait(false); continue; }
                    throw err;
                }
            }
            using (res)
            {
                JsonNode? json = null;
                if (!string.IsNullOrWhiteSpace(text)) { try { json = JsonNode.Parse(text); } catch (JsonException) { } }
                int status = (int)res.StatusCode;
                if (status >= 200 && status < 300)
                {
                    if (json is JsonObject o) return o;
                    var wrap = new JsonObject();
                    if (json != null) wrap["data"] = json;
                    return wrap;
                }
                if ((status == 429 || status >= 500) && retryable && attempt < _options.MaxRetries)
                {
                    var after = res.Headers.RetryAfter?.Delta;
                    await Task.Delay(after is { } d && d > TimeSpan.Zero ? (d > TimeSpan.FromSeconds(30) ? TimeSpan.FromSeconds(30) : d) : Backoff(attempt), cancellationToken).ConfigureAwait(false);
                    continue;
                }
                throw DelivrieException.FromResponse(status, json, text);
            }
        }
    }

    private static TimeSpan Backoff(int attempt) => TimeSpan.FromMilliseconds(Math.Min(8000, 500 * Math.Pow(2, attempt)) + Random.Shared.Next(250));
}
