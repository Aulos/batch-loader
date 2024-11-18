import http from "node:http";
import { createRequestListener } from "@mjackson/node-fetch-server";
import { createContext, provide, pull } from "@ryanflorence/async-provider";
import Database from "better-sqlite3";
import path from "node:path";

////////////////////////////////////////////////////////////////////////////////
import { batch } from "../../dist/batch-loader.js";

////////////////////////////////////////////////////////////////////////////////
// A function to create loaders inside of requests so their caches live and die
// with the request
function createLoaders() {
  return {
    loadMovie: batch(batchMovies, { onBatch: console.log }),
    loadActor: batch(batchActors, { onBatch: console.log }),
  };
}

////////////////////////////////////////////////////////////////////////////////
// batch functions that load recoreds in batches by id
let db = new Database(path.join(import.meta.dirname, "database.db"));

async function batchMovies(ids: number[]) {
  let placeholders = ids.map(() => "?").join(",");
  let query = `
    SELECT 
      m.*,
      JSON_GROUP_ARRAY(DISTINCT mg.genre_id) as genre_ids,
      JSON_GROUP_ARRAY(DISTINCT mc.cast_id) as cast_ids
    FROM movies m
    LEFT JOIN movie_genres mg ON m.id = mg.movie_id
    LEFT JOIN movie_cast mc ON m.id = mc.movie_id
    WHERE m.id IN (${placeholders})
    GROUP BY m.id
  `;

  return db
    .prepare(query)
    .all(ids)
    .map((movie: any) => {
      movie.genre_ids = JSON.parse(movie.genre_ids);
      movie.cast_ids = JSON.parse(movie.cast_ids);
      return movie as Movie;
    })
    .sort(
      // batch function results must be sorted in the same order as the input
      (a, b) => ids.indexOf(a.id) - ids.indexOf(b.id),
    );
}

async function batchActors(ids: number[]) {
  let placeholders = ids.map(() => "?").join(",");
  let query = `
    SELECT
      actor.*,
      JSON_GROUP_ARRAY(DISTINCT mc.movie_id) as movie_ids
    FROM cast_members as actor
    LEFT JOIN movie_cast mc ON actor.id = mc.cast_id
    WHERE actor.id IN (${placeholders})
    GROUP BY actor.id
  `;
  return db
    .prepare(query)
    .all(ids)
    .map((actor: any) => {
      actor.movie_ids = JSON.parse(actor.movie_ids);
      return actor as Actor;
    })
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

////////////////////////////////////////////////////////////////////////////////
// Web server

// batch-loader works well with async-provider to provide loaders to components
// across the app instead of passing them down to every ui that needs it
// https://github.com/ryanflorence/async-provider
let loadersCtx = createContext<ReturnType<typeof createLoaders>>();

async function handler(request: Request): Promise<Response> {
  // create loaders scoped to this request
  let loaders = createLoaders();

  // provide them with async-provider
  return provide([[loadersCtx, loaders]], async () => {
    let url = new URL(request.url);

    if (url.pathname === "/") {
      return HomePage();
    }

    let actorMatch = url.pathname.match(/\/actor\/(\d+)/);
    if (actorMatch) {
      return ActorPage(Number(actorMatch[1]));
    }

    let movieMatch = url.pathname.match(/\/movie\/(\d+)/);
    if (movieMatch) {
      return MoviePage(Number(movieMatch[1]));
    }

    return new Response("Not Found", { status: 404 });
  });
}

http.createServer(createRequestListener(handler)).listen(3000, () => {
  console.log(`http://localhost:3000`);
});

////////////////////////////////////////////////////////////////////////////////
// Components
async function HomePage() {
  let markup = Layout(html`
    <h1>Batch Loader</h1>
    <div style="display: flex; gap: 4rem">
      ${await renderList([
        // naively render several MovieTiles that load their own data
        MovieTile(34861),
        MovieTile(36195),
        MovieTile(34485),
      ])}
    </div>
  `);

  return new Response(markup, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function MovieTile(id: number) {
  // MovieTile can do its own data loading, we can simply render them without
  // worrying about creating an efficient database query for this specific page,
  // it'll automatically batch in an efficient way
  let { loadMovie } = pull(loadersCtx);
  let movie = await loadMovie(id);

  return html`
    <div>
      <h2>
        <a href="${`/movie/${movie.id}`}">${movie.title}</a>
        <small style="font-weight: 300">(${movie.year})</small>
      </h2>
      <div>
        <img
          src="${movie.thumbnail}"
          style="width: 400pxrem; height: 270px; float: left; margin: 0 0.5rem 0.5rem 0"
        />
        <p style="margin-top: 0">${movie.extract}</p>
        <p>
          <b>Cast</b>:
          <span>${await renderList(movie.cast_ids.map(ActorLink), " • ")}</span>
        </p>
      </div>
    </div>
  `;
}

async function ActorPage(id: number) {
  let { loadActor } = pull(loadersCtx);
  let actor = await loadActor(id);

  let threeColumnGridStyles =
    "display: grid; grid-template-columns: repeat(3, 1fr); gap: 4rem";

  let markup = Layout(html`
    <div style="max-width: 1200px; margin: auto;">
      <h1 style="text-align: center">${actor.name}</h1>
      <div style="${threeColumnGridStyles}">
        ${await renderList(actor.movie_ids.map(MovieTile))}
      </div>
    </div>
  `);

  return new Response(markup, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function ActorLink(id: number) {
  let { loadActor } = pull(loadersCtx);
  let actor = await loadActor(id);
  return html`<a href="${`/actor/${actor.id}`}"
    >${actor.name} <small>(${actor.movie_ids.length})</small></a
  >`;
}

async function MoviePage(id: number) {
  // pull the loaders from the context
  let { loadMovie } = pull(loadersCtx);

  // load an individual movie
  let movie = await loadMovie(id);

  let markup = Layout(html`
    <div style="max-width: 800px; margin: auto;">
      <h1 style="text-align: center">${movie.title}</h1>
      <img
        src="${movie.thumbnail}"
        style="width: 20rem; float: left; margin: 0 1rem 1rem 0"
      />
      <p>${movie.extract}</p>
      <p>
        <b>Cast</b>:
        <span>${await renderList(movie.cast_ids.map(ActorLink), " • ")}</span>
      </p>
    </div>
  `);

  return new Response(markup, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function Layout(children: string) {
  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <title>Batch Loader</title>
        <style>
          body {
            padding: 0 3rem;
            font-weight: 300;
            font-family: system-ui;
            font-size: 16px;
            line-height: 1.4;
          }
          a {
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        ${children}
      </body>
    </html>
  `;
}

////////////////////////////////////////////////////////////////////////////////
// random stuff
let html = String.raw;

async function renderList(children: Promise<string>[], separator: string = "") {
  let strings = await Promise.all(children);
  return strings.join(separator);
}

type Movie = {
  id: number;
  title: string;
  year: number;
  href: string;
  extract: string;
  thumbnail: string;
  thumbnail_width: string;
  thumbnail_height: string;
  genre_ids: number[];
  cast_ids: number[];
};

type Actor = {
  id: number;
  name: string;
  movie_ids: number[];
};
