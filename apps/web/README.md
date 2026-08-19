Reference client. Relay is the intended data layer (fragments map onto module
boundaries); urql is the fallback if the Relay conventions get in the way.

Forms import the same Zod schemas the API validates against, via
`@hookform/resolvers/zod`. One schema, two enforcement points.
