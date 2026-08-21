// Migrations.
//
// `services/*/package.json` has called `atlas migrate apply --env local` since
// the first commit, against a config that did not exist. This is that config.
//
// One migration directory for the whole repository rather than one per module.
// The modules own separate *schemas* inside one database, and a migration that
// adds a column to `people` and a foreign key in `platform` has to be one
// transaction or it is two half-applied states. Ownership is still enforced —
// by `.dependency-cruiser.cjs` at build time and by row-level security at
// runtime — and neither depends on the migration files being split.

variable "url" {
  type    = string
  default = getenv("DATABASE_URL")
}

// A throwaway database Atlas uses to compute the diff. It must not be the one
// being migrated: Atlas drops and recreates everything in it.
variable "dev_url" {
  type    = string
  default = getenv("ATLAS_DEV_URL")
}

env "local" {
  url     = var.url != "" ? var.url : "postgres://kithena:kithena@localhost:5432/kithena?sslmode=disable"
  dev     = var.dev_url != "" ? var.dev_url : "docker://postgres/17/dev?search_path=public"

  migration {
    dir = "file://migrations"
  }

  format {
    migrate {
      apply = format("{{ json . }}")
    }
  }
}

// Staging and production differ from local in exactly one way: the connection
// string arrives from the environment and is never written down here. Separate
// environments rather than one parameterised by a variable, so that deploying
// to production is a different word from deploying to staging in the workflow
// that runs it, and a typo cannot silently point one at the other.
env "staging" {
  url = getenv("DATABASE_URL")
  dev = getenv("ATLAS_DEV_URL")

  migration {
    dir = "file://migrations"
  }
}

env "production" {
  url = getenv("DATABASE_URL")
  dev = getenv("ATLAS_DEV_URL")

  migration {
    dir = "file://migrations"

    // Expand-contract only, per CLAUDE.md: add nullable, backfill, write, stop
    // reading, drop later. Atlas refuses a destructive change against this
    // environment rather than asking, because the answer against a
    // multi-tenant production database is always no.
    revisions_schema = "atlas"
  }

  lint {
    destructive {
      error = true
    }
  }
}
