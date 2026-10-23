import { useI18n } from './I18n.jsx';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

const ConfirmationContext = createContext(null);

export function useConfirmation() {
  return useContext(ConfirmationContext);
}

export const projectSummary = (project, t) => ({
  id: project.id,
  name: project.name,
  directory: project.identity?.directory || t('尚未关联目录'),
  address: project.url,
});

export function ConfirmationProvider({ children }) {
  const { t } = useI18n();
  const [choice, setChoice] = useState(null);
  const [checked, setChecked] = useState(false);
  const pending = useRef(null);
  const dialog = useRef(null);
  const cancel = useRef(null);

  const ask = useCallback((options) => {
    if (pending.current)
      return Promise.resolve({ confirmed: false, checked: false });
    return new Promise((resolve) => {
      pending.current = { resolve, opener: document.activeElement };
      setChecked(false);
      setChoice(options);
    });
  }, []);

  const finish = useCallback((confirmed, include = false) => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    dialog.current?.close();
    setChoice(null);
    current.resolve({ confirmed, checked: confirmed && include });
    queueMicrotask(() => {
      if (current.opener?.isConnected)
        current.opener.focus({ preventScroll: true });
    });
  }, []);

  useLayoutEffect(() => {
    if (!choice) return;
    dialog.current.showModal();
    cancel.current.focus({ preventScroll: true });
  }, [choice]);

  useEffect(
    () => () => {
      pending.current?.resolve({ confirmed: false, checked: false });
      pending.current = null;
    },
    [],
  );

  return (
    <ConfirmationContext.Provider value={ask}>
      {children}
      {choice && (
        <dialog
          ref={dialog}
          className={`confirmation-dialog ${choice.destructive ? 'is-destructive' : ''}`}
          role="alertdialog"
          aria-labelledby="confirmation-title"
          aria-describedby="confirmation-description"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = [
              ...dialog.current.querySelectorAll(
                'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
              ),
            ].filter((element) => element.getClientRects().length);
            const index = controls.indexOf(document.activeElement);
            if (event.shiftKey && index <= 0) {
              event.preventDefault();
              controls.at(-1)?.focus();
            } else if (
              !event.shiftKey &&
              (index === -1 || index === controls.length - 1)
            ) {
              event.preventDefault();
              controls[0]?.focus();
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            finish(false);
          }}
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              finish(true, checked);
            }}
          >
            <div className="confirmation-heading">
              <div className="dialog-header">
                <span className="mini-label">
                  LOCADE /{' '}
                  {choice.destructive ? 'HANDLE WITH CARE' : 'YOUR CHOICE'}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('关闭操作确认')}
                  onClick={() => finish(false)}
                >
                  ×
                </button>
              </div>
              <h2 id="confirmation-title">{t(choice.title)}</h2>
              <p id="confirmation-description">{t(choice.description)}</p>
            </div>
            <div
              className="confirmation-content"
              tabIndex={choice.items?.length ? 0 : undefined}
              role="region"
              aria-label={t('操作详情')}
            >
              {choice.items?.length > 0 && (
                <ul
                  className="confirmation-items"
                  aria-label={t('本次操作涉及的记录')}
                >
                  {choice.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <code>{item.id.slice(0, 8)}</code>
                      </div>
                      <span>{item.directory}</span>
                      <code>{item.address}</code>
                    </li>
                  ))}
                </ul>
              )}
              {choice.checkbox && (
                <label className="confirmation-checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setChecked(event.target.checked)}
                  />
                  <span>
                    <strong>{t(choice.checkbox.label)}</strong>
                    <small>{t(choice.checkbox.description)}</small>
                  </span>
                </label>
              )}
              {choice.note && (
                <p className="confirmation-note">{t(choice.note)}</p>
              )}
            </div>
            <div className="dialog-actions confirmation-actions">
              <button
                ref={cancel}
                type="button"
                className="button outline"
                onClick={() => finish(false)}
              >
                {t('取消')}
              </button>
              <button className="button primary" type="submit">
                {t(choice.confirmLabel)}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </ConfirmationContext.Provider>
  );
}
