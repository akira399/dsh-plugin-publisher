/**
 * dsh-plugin-publisher — browser half.
 *
 * Renders a settings card on 设置 → 插件配置 (the `settings.plugin.item` slot):
 *   - 「启用」开关：写入 settings namespace `dsh-plugin-publisher.enabled`，
 *     Host 据此注册/注销 `dsh-plugin-publishing` 技能（即 consent 授权门禁）。
 *   - 「GitHub Token」输入框（write-only，永不回显）：写入 credentials 域
 *     `GITHUB_TOKEN`，Host 自动同步到系统 Git 凭据管理器。
 *
 * 纯 React + 内联样式，不 import 任何插件包（仅用平台模块与服务注入），
 * 符合 client bundle 纯度门。
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-publisher",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useSyncExternalStore = react.useSyncExternalStore;

    var NS = "dsh-plugin-publisher";
    var CRED_REF = "GITHUB_TOKEN";

    var DICT_ZH = {
      title: "DSH 插件开发与发布 (dsh-plugin-publisher)",
      description: "注册 dsh-plugin-publishing 工作流技能（DSH 插件开发 → GitHub 发布）。技能驱动公开发布操作，必须由你主动启用。",
      enabledLabel: "启用技能",
      enabledHint: "开启后，本会话的技能目录中会出现 dsh-plugin-publishing。关闭即注销。",
      enabledOn: "已启用",
      enabledOff: "未启用",
      tokenLabel: "GitHub PAT（Fine-grained Personal Access Token）",
      tokenHint: "用于 GitHub 推送 / 创建仓库。保存后自动写入系统 Git 凭据管理器，且不会回显。留空表示保持现有值。",
      tokenConfigured: "已配置（内容不回显）",
      tokenUnset: "未配置",
      save: "保存",
      saving: "保存中 ...",
      discard: "放弃修改",
      dirtyHint: "有未保存的修改",
      failed: "保存失败，请重试",
      saved: "已保存。技能启用状态即时生效；PAT 已同步到系统凭据管理器。",
      notReady: "设置不可用（等待加载或只读）",
      patHelpTitle: "如何创建 GitHub PAT（个人访问令牌）？",
      patHelpSteps: [
        "1. 打开 GitHub → 右上角头像 → Settings",
        "2. 左侧最底部 Developer settings → Personal access tokens → Fine-grained tokens",
        "3. 点 Generate new token，填写名称（如 dsh-publish）与有效期",
        "4. Repository access 选择 All repositories（需要创建新仓库，无法预先指定）",
        "5. 在 Permissions → Repository permissions 中授予：",
        "    · Contents — Read and write（推送代码）",
        "    · Administration — Read and write（创建/删除仓库、设置 Topics）",
        "    · Metadata — Read（自动包含，保持开启）",
        "6. 点 Generate token，复制（只显示一次）后粘贴到上方输入框"
      ],
      patHelpNote: "Fine-grained PAT 形如 github_pat 开头（后接下划线与一长串随机字符）。它只用于通过系统 Git 凭据管理器向 GitHub 推送代码，本插件不会回显或上传。"
    };
    var DICT_EN = {
      title: "DSH plugin dev & publishing (dsh-plugin-publisher)",
      description: "Registers the dsh-plugin-publishing workflow skill (DSH plugin development → GitHub publishing). The skill drives public-publish operations, so it requires your explicit opt-in.",
      enabledLabel: "Enable skill",
      enabledHint: "When on, the dsh-plugin-publishing skill appears in this session's skill catalog. Turning off unregisters it.",
      enabledOn: "Enabled",
      enabledOff: "Disabled",
      tokenLabel: "GitHub PAT (fine-grained Personal Access Token)",
      tokenHint: "Used for GitHub push / repository creation. Saved into the system Git credential manager and never echoed. Leave blank to keep the current value.",
      tokenConfigured: "Configured (value not echoed)",
      tokenUnset: "Not configured",
      save: "Save",
      saving: "Saving ...",
      discard: "Discard",
      dirtyHint: "Unsaved changes",
      failed: "Save failed, please retry",
      saved: "Saved. Skill state takes effect immediately; the PAT was synced to the system credential manager.",
      notReady: "Settings unavailable (loading or read-only)",
      patHelpTitle: "How to create a GitHub PAT?",
      patHelpSteps: [
        "1. Open GitHub → avatar (top right) → Settings",
        "2. Developer settings (bottom left) → Personal access tokens → Fine-grained tokens",
        "3. Generate new token; set a name (e.g. dsh-publish) and an expiration",
        "4. Repository access: All repositories (required to create new repos)",
        "5. Under Permissions → Repository permissions grant:",
        "    · Contents — Read and write (push code)",
        "    · Administration — Read and write (create/delete repos, set topics)",
        "    · Metadata — Read (auto-included, keep it on)",
        "6. Generate token and copy it (shown once) into the field above"
      ],
      patHelpNote: "A fine-grained PAT starts with github_pat followed by an underscore and a long random string. It is only used to push to GitHub through the system Git credential manager; this plugin never echoes or uploads it."
    };

    function browserLang() {
      var raw = (typeof navigator !== "undefined" && navigator.language) || "zh";
      return String(raw).toLowerCase().split("-")[0] === "zh" ? "zh" : "en";
    }
    var langCurrent = browserLang();
    var t = function (key) {
      var dict = langCurrent === "en" ? DICT_EN : DICT_ZH;
      return dict[key] || key;
    };
    var localeChangeCbs = [];
    function notifyLocaleChange() {
      for (var i = 0; i < localeChangeCbs.length; i++) localeChangeCbs[i]();
    }

    var cardStyles = {
      root: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 10, padding: "16px 18px", background: "var(--dsw-alias-surface-l1, transparent)", display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 },
      title: { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
      desc: { margin: 0, fontSize: 13, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 },
      row: { display: "flex", alignItems: "center", gap: 10 },
      fieldLabel: { fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary)", minWidth: 110 },
      hint: { margin: 0, fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5 },
      input: { flex: 1, padding: "7px 10px", fontSize: 13, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-surface-l2, transparent)", color: "var(--dsw-alias-label-primary)", minWidth: 0 },
      check: { width: 16, height: 16, accentColor: "var(--dsw-alias-state-business-primary)" },
      badge: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)" },
      badgeOk: { fontSize: 12, color: "var(--dsw-alias-state-success, #2e7d32)" },
      actions: { display: "flex", gap: 8, marginTop: 2 },
      btn: { padding: "6px 14px", fontSize: 13, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2)", cursor: "pointer", background: "var(--dsw-alias-surface-l2, transparent)", color: "var(--dsw-alias-label-primary)" },
      btnPrimary: { padding: "6px 14px", fontSize: 13, borderRadius: 6, border: "none", cursor: "pointer", background: "var(--dsw-alias-state-business-primary, #4d6bfe)", color: "#fff" },
      msg: { margin: 0, fontSize: 12, color: "var(--dsw-alias-label-tertiary)" },
      msgErr: { margin: 0, fontSize: 12, color: "var(--dsw-alias-state-danger, #d32f2f)" },
      help: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: "10px 12px", background: "var(--dsw-alias-surface-l2, transparent)" },
      helpSummary: { fontSize: 13, fontWeight: 500, cursor: "pointer", color: "var(--dsw-alias-label-primary)", outline: "none" },
      helpStep: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", lineHeight: 1.7, marginTop: 6 },
      helpNote: { margin: "10px 0 0", fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 }
    };

    // ---- Controller: scope + credential + staged edits ----
    function makeController(ctx) {
      var api = ctx.get("connection").api;
      var scope = ctx.settingsScope.bind({ namespace: NS });
      var state = {
        ready: false,
        writable: false,
        enabled: false,
        dirty: false,
        saving: false,
        failed: false,
        message: "",
        tokenConfigured: false,
        tokenWritable: true,
        tokenDraft: ""
      };
      var stagedEnabled = null; // null = no change
      var stagedToken = "";    // "" = no change
      var listeners = [];
      var tokenRef = CRED_REF;

      function publish() {
        var snapshot = scope.getSnapshot();
        state.ready = snapshot.status === "ready";
        state.writable = snapshot.writable;
        var baseEnabled = Boolean(snapshot.value && snapshot.value.enabled);
        state.enabled = stagedEnabled === null ? baseEnabled : stagedEnabled;
        state.dirty = stagedEnabled !== null || stagedToken !== "";
        state.tokenDraft = stagedToken;
        for (var i = 0; i < listeners.length; i++) listeners[i](state);
      }

      function refreshCredential() {
        api.credentials.describe({ refs: [tokenRef] }).then(function (resp) {
          var view = resp && resp.result && resp.result.ok ? resp.result.value.credentials[tokenRef] : void 0;
          state.tokenConfigured = Boolean(view && view.configured);
          state.tokenWritable = view ? view.writable : true;
          publish();
        }).catch(function () {
          publish();
        });
      }

      scope.subscribe(function () {
        publish();
        refreshCredential();
      });
      refreshCredential();

      return {
        getSnapshot: function () { return state; },
        subscribe: function (listener) {
          listeners.push(listener);
          publish();
          return function () {
            listeners = listeners.filter(function (l) { return l !== listener; });
          };
        },
        editEnabled: function (value) {
          stagedEnabled = Boolean(value);
          state.message = "";
          publish();
        },
        editToken: function (value) {
          stagedToken = value;
          state.message = "";
          publish();
        },
        discard: function () {
          stagedEnabled = null;
          stagedToken = "";
          state.message = "";
          publish();
        },
        save: async function () {
          state.saving = true;
          state.failed = false;
          state.message = "";
          publish();
          try {
            if (stagedEnabled !== null) await scope.set("enabled", stagedEnabled);
            if (stagedToken !== "") await api.credentials.set({ ref: tokenRef, value: stagedToken });
            stagedEnabled = null;
            stagedToken = "";
            await refreshCredential();
            state.saving = false;
            state.message = "saved";
            publish();
            return true;
          } catch (error) {
            state.saving = false;
            state.failed = true;
            state.message = "failed";
            publish();
            return false;
          }
        }
      };
    }

    // ---- Card component ----
    function PublisherCard(props) {
      var controller = props.publisherCard;
      var state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
      var localeTick = useState(0)[1];
      useEffect(function () {
        var cb = function () { localeTick(function (x) { return x + 1; }); };
        localeChangeCbs.push(cb);
        return function () {
          localeChangeCbs = localeChangeCbs.filter(function (f) { return f !== cb; });
        };
      }, []);
      var disabled = !state.writable || state.saving;
      return h("div", { style: cardStyles.root },
        h("h3", { style: cardStyles.title }, t("title")),
        h("p", { style: cardStyles.desc }, t("description")),
        h("label", { style: cardStyles.row },
          h("input", {
            type: "checkbox",
            style: cardStyles.check,
            checked: state.enabled,
            disabled: disabled,
            onChange: function (e) { controller.editEnabled(e.target.checked); }
          }),
          h("span", { style: cardStyles.fieldLabel }, t("enabledLabel")),
          h("span", { style: state.enabled ? cardStyles.badgeOk : cardStyles.badge }, state.enabled ? t("enabledOn") : t("enabledOff"))
        ),
        h("p", { style: cardStyles.hint }, t("enabledHint")),
        h("div", { style: cardStyles.row },
          h("label", { style: cardStyles.fieldLabel, htmlFor: "publisher-token" }, t("tokenLabel")),
          h("input", {
            id: "publisher-token",
            type: "password",
            style: cardStyles.input,
            placeholder: state.tokenConfigured ? t("tokenConfigured") : t("tokenUnset"),
            disabled: disabled,
            value: state.tokenDraft || "",
            onChange: function (e) { controller.editToken(e.target.value); }
          })
        ),
        h("p", { style: cardStyles.hint }, t("tokenHint")),
        h("details", { style: cardStyles.help },
          h("summary", { style: cardStyles.helpSummary }, t("patHelpTitle")),
          t("patHelpSteps").map(function (step, i) {
            return h("div", { key: i, style: cardStyles.helpStep }, step);
          }),
          h("p", { style: cardStyles.helpNote }, t("patHelpNote"))
        ),
        h("div", { style: cardStyles.actions },
          h("button", {
            type: "button",
            style: cardStyles.btnPrimary,
            disabled: disabled,
            onClick: function () { void controller.save(); }
          }, state.saving ? t("saving") : t("save")),
          h("button", {
            type: "button",
            style: cardStyles.btn,
            disabled: state.saving,
            onClick: function () { controller.discard(); }
          }, t("discard"))
        ),
        state.dirty ? h("p", { style: cardStyles.msg }, t("dirtyHint")) : null,
        state.failed ? h("p", { style: cardStyles.msgErr }, t("failed")) : null,
        state.message === "saved" ? h("p", { style: cardStyles.msg }, t("saved")) : null,
        !state.ready ? h("p", { style: cardStyles.msg }, t("notReady")) : null
      );
    }

    // ---- Plugin entry ----
    function apply(ctx) {
      if (ctx.locale && typeof ctx.locale.register === "function") {
        try {
          var dispose = ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN });
          if (typeof ctx.effect === "function") ctx.effect(() => dispose, "dsh-plugin-publisher: dictionaries");
        } catch (e) { /* namespace collision: ignore */ }
        try { t = ctx.locale.bind(NS); } catch (e) { /* keep fallback */ }
        try { langCurrent = ctx.locale.getLocale().active || langCurrent; } catch (e) { /* ignore */ }
        if (typeof ctx.locale.subscribe === "function") {
          try {
            ctx.locale.subscribe(function () {
              try { langCurrent = ctx.locale.getLocale().active; } catch (e) { /* ignore */ }
              notifyLocaleChange();
            });
          } catch (e) { /* ignore */ }
        }
      }

      var controller = makeController(ctx);
      // Re-read the credential badge when it changes elsewhere.
      if (ctx.remote && typeof ctx.remote.$on === "function") {
        ctx.effect(() => ctx.remote.$on("credentials/updated", function (ref) {
          if (ref === CRED_REF) controller.refreshCredential();
        }), "dsh-plugin-publisher: credential invalidations");
      }

      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          id: "dsh-plugin-publisher",
          order: 40,
          locale: NS,
          inject: function () {
            return { publisherCard: controller };
          }
        }, PublisherCard);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "settingsScope", "connection", "remote"];
    return module.exports;
  }
});
