export default function ProvidersSettings() {
  return (
    <section data-testid="providers-settings" className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Configure API keys for each backend. Keys are stored in your system keychain.
      </p>
      <div className="rounded-md border border-border/60 bg-card/40 p-3 text-[11px] text-muted-foreground">
        Provider configuration is managed via the OS keychain. Use{" "}
        <code className="rounded bg-muted/40 px-1 font-mono">
          maverick keys set &lt;provider&gt;
        </code>{" "}
        from a terminal or the workspace command palette.
      </div>
    </section>
  );
}
