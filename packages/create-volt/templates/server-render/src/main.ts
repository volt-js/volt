/**
 * The browser entry, and almost all of it is a comment.
 *
 * The stylesheet is imported first so the page is styled before anything is
 * mounted into it. Then the wiring: `virtual:volt/client` is generated
 * by the plugin and decides between attaching to the server's markup and
 * building the page, by whether the page says this build rendered it — which
 * is the difference between this project's `ssr` routes and its `csr` one,
 * and between this deploy's pages and a previous one's.
 *
 * There is nothing to configure here. This file exists so the project has a
 * place of its own to put anything that must happen before the application
 * starts, which is where it would go.
 */
import './styles.scss';
import 'virtual:volt/client';
