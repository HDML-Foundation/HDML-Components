/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, CONN_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `HdmlConnection` component represents a connection to a
 * database. It is used to define the connection details for various
 * database types.
 *
 * The `hdml-connection` tag allows you to specify the `name` and
 * `type` attributes to identify and categorize your database
 * connections. Choose the appropriate type based on the database
 * system you are connecting to.
 *
 * @tagname hdml-connection
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when it is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} name - The name of the connection.
 *
 * @attribute {string} description - The description of the
 * connection.
 *
 * @attribute {string} type - The type of the database. Available
 * types are:
 * - `postgresql`
 * - `mysql`
 * - `mssql`
 * - `mariadb`
 * - `oracle`
 * - `clickhouse`
 * - `druid`
 * - `ignite`
 * - `redshift`
 * - `bigquery`
 * - `googlesheets`
 * - `elasticsearch`
 * - `mongodb`
 * - `snowflake`
 *
 * @attribute {string} ssl - A boolean value indicating whether SSL is
 * enabled. Appliable to the following connector types:
 * - `postgresql`
 * - `mysql`
 * - `mssql`
 * - `mariadb`
 * - `oracle`
 * - `clickhouse`
 * - `druid`
 * - `ignite`
 * - `redshift`
 * - `mongodb`
 *
 * @attribute {string} host - The host address of the database.
 * Appliable to the following connector types:
 * - `postgresql`
 * - `mysql`
 * - `mssql`
 * - `mariadb`
 * - `oracle`
 * - `clickhouse`
 * - `druid`
 * - `ignite`
 * - `redshift`
 * - `elasticsearch`
 * - `mongodb`
 *
 * @attribute {string} port - The port of the database. Appliable to
 * the following connector types:
 * - `elasticsearch`
 * - `mongodb`
 *
 * @attribute {string} user - The username for authentication.
 * Appliable to the following connector types:
 * - `postgresql`
 * - `mysql`
 * - `mssql`
 * - `mariadb`
 * - `oracle`
 * - `clickhouse`
 * - `druid`
 * - `ignite`
 * - `redshift`
 * - `elasticsearch`
 * - `mongodb`
 * - `snowflake`
 *
 * @attribute {string} password - The password for authentication.
 * Appliable to the following connector types:
 * - `postgresql`
 * - `mysql`
 * - `mssql`
 * - `mariadb`
 * - `oracle`
 * - `clickhouse`
 * - `druid`
 * - `ignite`
 * - `redshift`
 * - `elasticsearch`
 * - `mongodb`
 * - `snowflake`
 *
 * @attribute {string} credentials-key - Base64 encoded JSON file that
 * contains GCP credentials. Appliable to the following connector
 * types:
 * - `bigquery`
 * - `googlesheets`
 *
 * @attribute {string} project-id - The ID of the Google Cloud
 * Platform (GCP) project. Appliable to the `bigquery` connector.
 *
 * @attribute {string} sheet-id - The ID of the Google Sheets
 * document, that contains the table mapping. Appliable to the
 * `googlesheets` connector.
 *
 * @attribute {string} region - The region where the Elasticsearch
 * server is located (required for AWS deployment). Appliable to the
 * `elasticsearch` connector.
 *
 * @attribute {string} access-key - The access key for AWS
 * authentication (required for AWS deployment). Appliable to the
 * `elasticsearch` connector.
 *
 * @attribute {string} secret-key - The secret key for AWS
 * authentication (required for AWS deployment). Appliable to the
 * `elasticsearch` connector.
 *
 * @attribute {string} schema - The name of the MongoDB collection
 * containing schema information. Appliable to the `mongodb`
 * connector.
 *
 * @attribute {string} account - Snowflake account name. Appliable to
 * the `snowflake` connector.
 *
 * @attribute {string} warehouse - Snowflake warehouse name. Appliable
 * to the `snowflake` connector.
 *
 * @attribute {string} database - Snowflake database name. Appliable
 * to the `snowflake` connector.
 *
 * @attribute {string} role - Snowflake user role name. Appliable to
 * the `snowflake` connector.
 */
@customElement(HDML_TAG_NAMES.CONNECTION)
export class HdmlConnection extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.NAME]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.DESCRIPTION]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.SSL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.HOST]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.PORT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.USER]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.PASSWORD]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.PROJECT_ID]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.CREDENTIALS_KEY]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.SHEET_ID]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.REGION]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.ACCESS_KEY]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.SECRET_KEY]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.SCHEMA]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.ACCOUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.WAREHOUSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.DATABASE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONN_ATTRS_LIST.ROLE]: null | string = null;
}
